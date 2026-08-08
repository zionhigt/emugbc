# PPU CGB — cahier de lots

> **Objectif du jalon** : faire tourner un PPU Game Boy Color, sans perdre le DMG,
> et pouvoir basculer de l'un à l'autre.
>
> **Contrainte de conception, posée d'entrée** : le CGB est une **surcharge** du
> DMG. Pas un second PPU écrit à côté, pas un `if (isCGB)` semé dans le rendu :
> une sous-classe qui redéfinit les quelques endroits où le matériel diverge.

---

## 1. L'idée directrice

Le geste existe déjà dans le dépôt, et c'est le meilleur point de repère : les
canaux de l'APU. `Channel(start, chanController)` fabrique une classe générique,
puis chaque canal en dérive et ne redéfinit **que** ce qui lui est propre —
le canal 3 remplace `DAC`, `volume` et `amplitude`, et hérite du reste.

```
channel3.js :   class Chan extends Parent { get DAC() {...} amplitude(cycle) {...} }
```

Le PPU est déjà une usine de la même forme :

```
ppu/index.js :  export default function(machine) { class PPU {...}; return PPU }
```

Donc `CGBPPU extends DMGPPU` est exactement le même geste, à une condition
près : **il faut que les endroits où le CGB diverge soient des méthodes**, pas des
expressions noyées au milieu d'une boucle. Aujourd'hui ils ne le sont pas. C'est
tout l'objet du lot 0.

### L'analogie pour tenir le cap

Le DMG et le CGB, ce sont **le même atelier, avec des bacs de peinture en plus**.
La chaîne de montage ne change pas : on lit la carte, on va chercher la tuile, on
extrait deux bits par pixel, on pousse dans la FIFO. Ce qui change, c'est
qu'à chaque tuile le CGB va lire **une étiquette rangée dans un second tiroir**
(la banque 1 de VRAM) qui dit : quel bac de peinture prendre, faut-il retourner
la tuile, et est-ce qu'elle passe devant les sprites.

Retiens cette phrase, elle décide de tout le découpage : **le CGB ne change pas
le trajet du pixel, il change ce qu'on lit au passage et comment on le colorie.**

---

## 2. État des lieux

### Ce sur quoi on s'appuie

| acquis | où |
|---|---|
| PPU dot-précis, mooneye PPU 12/12 | `ppu/index.js`, chapitre CLOS |
| `computeState(cycle, dotOffset)` : mode et ligne dérivés de l'horloge | `ppu/index.js:480` |
| Le drapeau CGB de la cartouche est déjà LU (0x143) | `Cartridge.js:100`, `_raw_cgb_flag` |
| Table de registres figée, extensible | `ppu/index.js:221` |
| Le routage mémoire par plages, une classe de section par périphérique | `memory/index.js` |

### Ce qui bloque, et qu'il faut ouvrir

1. **`Fetcher` est privé et instancié en dur** (`this.fetcher = new Fetcher(this)`).
   Une sous-classe ne peut ni le remplacer ni le dériver. Or c'est là que se lit
   la tuile de fond : le point exact où le CGB doit lire son étiquette.
2. **Le coloriage est écrit en clair, à trois endroits différents** :
   `Fetcher.tick` (fond), `renderWindow` (fenêtre), `renderSprites` (sprites), tous
   avec la même expression `(palette >> (teinte * 2)) & 0b11`. Trois copies à
   surcharger au lieu d'une.
3. **`this.screen` est un `Uint8Array` de teintes 0-3.** Le CGB en produit 32 768.
   Le contrat de sortie doit changer — voir §4, décision D1.
4. **`bgLine` ne retient que la teinte**, or le CGB a besoin en plus du bit de
   priorité de l'étiquette de tuile.
5. **`bus.ppuRead(addr)` ne sait pas viser une banque.** Il tape `memory._read`,
   c'est-à-dire la RAM plate de 64 Ko.
6. **Tout le bloc 0xFF4C-0xFFFF tombe dans une section plate** (`overflow3`,
   `memory/index.js:289`). VBK, BCPS/BCPD, OCPS/OCPD, OPRI, HDMA, SVBK n'ont
   aucun propriétaire.

---

## 3. La règle d'oracle *(corrigée après coup — le premier découpage était fautif)*

Le découpage initial mettait `cgb-acid2` aux lots 4 et 5, et rien d'extérieur
entre le lot 1 et là. **C'est un mauvais motif, et il faut le nommer** : un oracle
placé au bout d'une chaîne d'étapes non vérifiées ne peut plus localiser la faute.
Rouge au lot 5, le coupable est dans la banque, les palettes, les étiquettes ou
les sprites — quatre suspects. Pire : les TU des lots intermédiaires sont écrits
par moi contre pandocs, donc **ils sont verts précisément parce qu'ils encodent ma
lecture**, juste ou fausse. Une lecture fautive passe le contrôle et n'explose que
six étapes plus loin.

**La règle, désormais** : *chaque lot finit sur quelque chose d'extérieur à ma
tête, qui ne peut être vert que si CE lot est juste.*

Trois conséquences concrètes :

1. **Un oracle par lot, pas un oracle à la fin.** Les ROMs mooneye `-C` déjà
   présentes arbitrent la MÉCANIQUE (valeurs au démarrage, bits inutilisés,
   registres non mappés) et non l'image finale : ce sont elles qui doivent fermer
   les lots 1 à 3.
2. **Chaque oracle vient avec son NÉGATIF.** `boot_regs-cgb` doit passer en CGB
   *et échouer en DMG* — mooneye documente lui-même sa liste d'échecs attendus.
   Sans le négatif, on ne prouve pas que la bascule fait quoi que ce soit.
3. **`cgb-acid2` cesse d'être un examen final** : dès qu'il peut tourner, il
   devient une MESURE — un nombre de pixels faux, comparé à l'image de référence,
   qui doit décroître à chaque lot et finir à zéro. Un compteur qu'on lit à chaque
   étape, pas un verdict qu'on découvre à la fin.

### Deux prérequis découverts en mesurant

**P1 — Il n'existe AUCUN oracle de rendu, même en DMG.** `dmg-acid2.gb` est une
fixture que rien n'exécute : elle n'apparaît que dans deux commentaires de test.
Le lot 0 a donc traversé tout le chemin de rendu sans filet d'image. Avant
d'aller plus loin il faut un **harnais de rendu** : insérer la ROM, tourner N
trames, comparer le tampon écran. Deux niveaux, à ne pas confondre :

- un **instantané de référence** produit par notre propre code — disponible tout
  de suite, sans rien télécharger. Il attrape les RÉGRESSIONS (il aurait gardé le
  lot 0) mais ne prouve rien : il fige nos bugs actuels autant que nos succès.
- une **image de référence** venue du dépôt de la ROM — la seule qui prouve la
  justesse. À récupérer, comme `cgb-acid2.gb`.

**P2 — `unused_hwio-C` n'est pas utilisable tant que `unused_hwio-GS` est rouge.**
Mesuré : la variante DMG échoue déjà aujourd'hui. Les deux ROMs testent le même
plan d'IO, la version `-C` n'y ajoute que `$FF4F`, `$FF68`, `$FF6A`, les registres
CGB indocumentés et le fait que `$FF4C` reste non mappé. Tant que la base DMG est
rouge, l'écart n'est pas lisible : on ne saurait pas si l'échec vient du CGB ou
d'un masque DMG manquant. **Fermer `unused_hwio-GS` est donc un prérequis**, et
c'est un trou de justesse DMG qu'on ne se connaissait pas.

### État mesuré des oracles (2026-08-08)

| ROM | aujourd'hui | ferme quel lot |
|---|---|---|
| `boot_regs-dmgABC.gb` | **passe** | garde-fou du lot 1 |
| `boot_regs-cgb.gb` | échoue (on démarre en DMG) | **lot 1** |
| `unused_hwio-GS.gb` | **échoue** | prérequis P2 |
| `unused_hwio-C.gb` | échoue | **lots 2 et 3**, après P2 |
| `boot_hwio-C.gb` | échoue | lots 2-3, appoint |
| `vblank_stat_intr-C.gb` | non mesuré | lot 2-3, appoint |
| `dmg-acid2.gb` | **exécuté depuis le lot 0.5** | filet du rendu |
| `cgb-acid2.gbc` | **déposé, branché en ligne de base** | lots 4-5, en mesure continue |

---

## 3 bis. Inventaire des ROMs — ce qu'on a, ce qu'on n'a pas

**À lire avant de promettre quoi que ce soit.** Inventaire réel de
`src/test/fixtures/` au moment d'écrire ce cahier :

| ROM | présente ? | ce qu'elle arbitre |
|---|---|---|
| `mooneye/misc/boot_regs-cgb.gb` | **oui** | registres CPU au démarrage en modèle CGB |
| `mooneye/misc/boot_div-cgb0.gb`, `-cgbABCDE.gb` | **oui** | DIV au démarrage, par révision |
| `mooneye/misc/boot_hwio-C.gb` | **oui** | valeurs de l'IO au démarrage, modèle C |
| `mooneye/misc/bits/unused_hwio-C.gb` | **oui** | bits inutilisés de l'IO, modèle C |
| `mooneye/misc/ppu/vblank_stat_intr-C.gb` | **oui** | IRQ VBlank + STAT, modèle C |
| **`cgb-acid2.gb`** | **NON** | **le rendu CGB entier — fond, étiquettes, sprites, priorités** |

> **Conséquence directe : les lots 4 et 5 n'ont pas d'oracle tant que
> `cgb-acid2.gb` n'est pas déposé dans `src/test/fixtures/`.**
> C'est la ROM de mattcurrie, pendant exact de `dmg-acid2` déjà présente. Sans
> elle, on avance sur des TU écrits à la main contre pandocs — ce qui marche pour
> la mécanique (banques, palettes, auto-incrément) mais pas pour la table de
> priorités du lot 5, qui est précisément le genre de règle qu'on croit avoir
> comprise et qu'on n'a pas.
>
> **À faire avant le lot 4.** Les cinq ROMs mooneye ci-dessus, elles, deviennent
> exploitables dès le lot 1.

---

## 4. Décisions à trancher AVANT le premier test

Conformément à la règle du projet : on fige les noms et les signatures **avant**
que j'écrive la moindre TU, sinon les tests figent une interface qu'on regrette.

### D1 — Le format du tampon écran — **OUVERTE**

Aujourd'hui `screen` est un `Uint8Array(160*144)` de teintes 0-3, que
`CanvasRenderer` traduit par une table de 4 couleurs. Le CGB rend du RGB555.

| option | contenu de `screen` | conséquence |
|---|---|---|
| **A — RGB555 unifié** | `Uint16Array`, 0bxBBBBBGGGGGRRRRR | DMG et CGB sortent le même format ; le DMG traverse sa palette de 4 teintes dans le PPU. Le front ne connaît plus qu'un seul cas. **Change le contrat DMG.** |
| **B — deux plans** | `screen` (teinte) + `paletteLine` (n° de palette) | Ne touche pas le DMG, mais le front doit refaire la résolution de couleur, et les tests DMG existants restent valides tels quels. |
| **C — deux tampons** | `screen` en DMG, `screenRGB` en CGB | Aucun risque de régression, mais deux chemins à maintenir dans le worker, le renderer et le profileur. |

Cette décision ne bloque **pas** la première étape du lot 0 (l'injection du
fetcher), qui ne touche pas au tampon. Elle devra être prise avant le portage du
coloriage, plus loin dans le même lot.

### D2 — Le choix du modèle

Tu as tranché : on doit pouvoir basculer à la main. Proposition à confirmer :

- `header.isCgb` (nouveau getter sur 0x143 : `0x80` = compatible, `0xC0` = CGB seul)
  donne le **défaut** ;
- un réglage explicite (`auto` | `dmg` | `cgb`) peut le forcer ;
- `MachineBuilder({ model })` choisit la classe de PPU à la construction.

### D3 — Nommage des coutures

À figer maintenant (identifiants en anglais, prose en français, comme partout) :

```
tileAttributes(mapAddress)      // DMG : 0 ; CGB : l'octet de la banque 1
backgroundColor(shade, attrs)   // le coloriage du fond, un seul endroit
spriteColor(shade, sprite)      // le coloriage des sprites
spriteOrder(visibles)           // DMG : x puis index ; CGB (OPRI) : index seul
createFetcher()                 // l'usine à FIFO, surchargeable
bus.ppuReadBank(addr, bank)     // lecture visant une banque de VRAM
```

---

## 5. Les lots

Chaque lot suit la même boucle : **concept + analogie -> je rédige les TU ->
tu codes jusqu'au vert -> on ferme.** Un lot ne s'ouvre qu'une fois le précédent
fermé. Aucun lot n'a le droit de faire rougir les 1579 tests existants.

---

### Lot 0 — Ouvrir les coutures — **FERMÉ**

**Objectif** : rendre le PPU DMG surchargeable, sans changer une seule de ses
sorties.

**Le contrat du lot** : la suite complète est verte avant, elle est verte après,
et `dmg-acid2` rend le même écran. Ce lot ne se juge pas à ce qu'il ajoute mais à
ce qu'il ne casse pas. **Tenu : 1583 -> 1595 tests, mooneye PPU 12/12 inchangé.**

Travaux réalisés :

1. **`Fetcher` exporté et INJECTÉ dans le constructeur** du PPU, sans valeur par
   défaut — un défaut ferait retomber le CGB sur la FIFO DMG en silence, et la
   panne se lirait comme un bug de rendu.
2. **`backgroundColor(shade, attrs)` / `spriteColor(shade, sprite)`** : les trois
   copies de `(palette >> (teinte * 2)) & 0b11` (fetcher, fenêtre, sprites)
   fusionnent en deux méthodes.
3. **`tileAttributes(mapAddress)`** rend `0` en DMG. Le fetcher l'interroge à
   l'adresse de la carte, et **verrouille l'étiquette au moment de l'empilement** :
   la tuile suivante est lue alors qu'il reste sept pixels de la précédente à
   sortir, un seul champ les colorierait avec la mauvaise étiquette. Invisible en
   DMG (tout vaut 0), fatal en CGB.
4. **`spriteOrder(visibles)`** extrait le tri de `visibleLineSprites`.
5. **`bus.ppuReadBank(addr, bank)`** ; la banque est ignorée en DMG. Le bus est au
   passage **bâti une seule fois** — il était reconstruit à chaque accès, et le
   fetcher l'appelle plusieurs fois par pixel.
6. **`buildRegistersMapping()`** surchargeable, et la table bâtie **à la première
   demande** et non dans le constructeur : les champs d'une sous-classe ne sont
   posés qu'au retour de `super()`, les figer plus tôt les manquerait.

**TU** : 16 tests de couture dans `ppu.test.js`. Chacun DESSINE avant de conclure —
une couture déclarée mais absente du trajet du pixel ne vaut rien. Vérifiés par
mutation : retirer le verrou d'étiquette fait tomber le test 3, figer la table
dans le constructeur fait tomber les deux de la table.

**Reporté** : l'application de D1 (format du tampon écran) part au **lot 3**, avec
les palettes. Extraire la couture du coloriage n'exige pas de trancher le format —
`backgroundColor` rend aujourd'hui une teinte 0-3, elle rendra du RGB555 le jour
où D1 sera prise, sans que sa signature bouge.

---

### Lot 0.5 — Le harnais de rendu *(prérequis P1)*

**Objectif** : que `dmg-acid2` soit enfin EXÉCUTÉ, et que le chemin de rendu ait
un filet. Insérer la ROM, tourner assez de trames, comparer le tampon écran.

Instantané de référence d'abord (disponible sans rien télécharger, attrape les
régressions), image de référence ensuite si tu la récupères (prouve la justesse).
C'est ce harnais que `cgb-acid2` réutilisera au lot 4 — en MESURE, pas en verdict.

**Oracle** : lui-même. Et il ferme rétroactivement le trou du lot 0.

---

### Lot 1 — Le modèle : DMG ou CGB, et comment on choisit — **FERMÉ**

**Objectif** : la machine sait quel modèle elle est, et le CPU démarre avec les
bons registres.

Travaux : drapeau CGB exposé sur l'en-tête (0x143) ; notion de modèle sur la
`Machine`, résolue à `plugCartridge` (défaut par la cartouche, forçage explicite
prioritaire) ; `postBoot(model)`.

**Fait qui tranche D2 tout seul** : `boot_regs-cgb.gb` déclare `0x143 = 0x00`. Les
ROMs mooneye ne se déclarent JAMAIS CGB — elles mesurent ce que la console a
laissé. Le forçage manuel n'est donc pas un confort, il est **nécessaire pour
faire tourner l'oracle**.

Valeurs, prises dans la source de l'oracle et non dans pandocs (elles diffèrent
de ce qu'on croit savoir) :

```
DMG   A=$01 F=$B0 B=$00 C=$13 D=$00 E=$D8 H=$01 L=$4D   SP=$FFFE
CGB   A=$11 F=$80 B=$00 C=$00 D=$00 E=$08 H=$00 L=$7C   SP=$FFFE
```

**Le choix de la classe de PPU part au lot 2**, quand il y aura réellement deux
classes : le PPU naît dans le constructeur de `Machine`, donc AVANT que la
cartouche soit connue. Le déplacer maintenant ne sélectionnerait rien.

**Trois choses apprises en le faisant :**

- Le modèle est celui de la CONSOLE, pas de la cartouche : une cartouche 0x80
  glissée dans une DMG tourne en DMG. D'où trois valeurs (`dmg`, `cgb`, `auto`)
  et non deux, `auto` étant la seule qui consulte l'en-tête. Le défaut reste
  `dmg` tant qu'il n'existe aucun PPU CGB.
- La préférence passe par le CONSTRUCTEUR de `Machine`, pas par l'usine : deux
  appelants lui passaient déjà un sixième argument qu'elle ignore, et y glisser
  la préférence lui aurait fait recevoir un timer. Argument mort supprimé au
  passage.
- Onze des ROMs blargg portent 0x143 = 0x80. Mesuré : sous `auto` elles
  résolvent bien en `cgb` et **passent toutes** — les registres CGB au démarrage
  ne les gênent pas. Bon présage pour le jour où le front basculera sur `auto`.

**Oracles, avec leurs négatifs** :

| ROM | modèle forcé | attendu |
|---|---|---|
| `boot_regs-cgb.gb` | cgb | passe |
| `boot_regs-cgb.gb` | dmg | **échoue** |
| `boot_regs-dmgABC.gb` | dmg | passe (déjà vert) |
| `boot_regs-dmgABC.gb` | cgb | **échoue** |

---

### Lot 1.5 — Fermer les masques de lecture DMG — **FERMÉ**

**Objectif** : rendre `unused_hwio-GS.gb` vert. Bits inutilisés et registres non
mappés du plan `$FFxx` : tous doivent se lire à 1.

Ce n'est pas du CGB, c'est un trou de justesse DMG découvert en mesurant. Mais
sans lui, `unused_hwio-C` reste illisible aux lots 2 et 3 : on ne saurait pas si
l'échec vient du CGB ou d'un masque DMG manquant.

**Oracle** : `unused_hwio-GS.gb`, **désormais vert**. Et `-C` doit rester ROUGE —
c'est le négatif du lot : il prouve qu'on n'a pas satisfait le CGB par accident.
À retourner quand le lot 3 sera fermé.

**Ce qui était faux, relevé en rejouant la table de la ROM contre notre mémoire
plutôt qu'en devinant :**

- quatre registres nommés : **P1** (bits 6-7), **SC** (1-6), **TAC** (3-7),
  **IF** (5-7). IE était déjà juste.
- **60 des 65 adresses non mappées** : seules `$FF15 $FF1F $FF27-29` étaient
  correctes, parce que l'APU y avait déjà posé des registres muets.

Chaque propriétaire masque désormais ses propres bits, comme l'APU le fait déjà
avec `maskRegistersMapping`. Les trous du plan passent par une `UnmappedSection`
qui rend 0xFF et perd les écritures — **c'est le tiroir dans lequel le CGB
viendra poser VBK, les palettes, HDMA et SVBK**.

**Piège rencontré** : sortir `$FF02` de la section série pour lui coller son
masque a coupé la sonnette (c'est cette section qui guette le bit 7 de SC pour
déclencher l'écho), et avec elle le verdict de TOUTES les ROMs blargg et
mooneye. Le masque doit vivre DANS la section, pas à côté.

**Cinq tests portés, aucun supprimé** : le round-trip de TAC et quatre tests de
`dispatch` encodaient l'ancien comportement — ils décrivaient notre
implémentation, pas le matériel.

---

### Lot 2 — La VRAM double et VBK

**Objectif** : deux banques de 8 Ko, commutées par 0xFF4F, et un PPU capable de
lire une banque précise sans passer par la commutation.

**Le piège à ne pas manquer** : les règles de blocage par mode (le `read != write`
dot-précis du chapitre PPU) s'appliquent **aux deux banques**. Ce lot ne doit pas
les contourner en tapant `memory._read` directement.

**TU** : écriture/lecture par banque ; en DMG l'écriture de VBK est sans effet ;
le blocage mode 3 reste intact.

**Oracle** : `unused_hwio-C.gb` arbitre nommément `$FF4F` — `test $FF4F %11111110`,
donc les bits 1 à 7 lus à 1. Plus `boot_hwio-C.gb` pour sa valeur au démarrage.
C'est aussi ici que se choisit enfin la CLASSE de PPU selon le modèle, puisqu'il
y en a désormais deux.

---

### Lot 3 — Les palettes CGB et la sortie couleur

**Objectif** : 0xFF68-0xFF6B (BCPS/BCPD/OCPS/OCPD), deux fois 64 octets de RAM de
palette, auto-incrément sur le bit 7 de l'index, et le RGB555 qui en sort.

**TU** : l'auto-incrément avance après une écriture et **pas** après une lecture ;
relecture fidèle ; décodage RGB555 ; huit palettes de quatre couleurs de chaque
côté ; en DMG ces registres n'existent pas.

**Oracle** : `unused_hwio-C.gb` arbitre `$FF68` et `$FF6A` — `%01000000`, donc le
bit 6 lu à 1 des deux côtés. C'est ici aussi que se prend la décision D1, et que
`cgb-acid2` doit commencer à tourner en MESURE, même très rouge : le compte de
pixels faux devient le chiffre qu'on suit jusqu'au lot 5.

---

### Lot 4 — Les étiquettes de tuile et le fond CGB

**Objectif** : le fetcher lit l'octet d'attribut dans la banque 1, à la même
adresse que l'identifiant de tuile dans la banque 0, et l'applique : palette 0-7,
banque de la tuile, miroir X, miroir Y, bit de priorité.

**Ce qui change dans le trajet du pixel** : rien, sauf que `tileAttributes` ne rend
plus 0. C'est là que le lot 0 se paie.

`bgLine` gagne son plan de priorité (le bit 7 de l'étiquette), sans lequel le lot 5
ne peut pas trancher.

**TU** : chaque bit de l'attribut isolément, puis en combinaison (miroir X + Y).

**Oracle** : `cgb-acid2.gbc`, en MESURE et non en verdict — l'écart avec
l'instantané du lot précédent dit ce que le lot a changé à l'image. Déposé et
branché depuis le lot 1.5 ; l'image de référence de son dépôt reste à récupérer
pour transformer la mesure en preuve.

---

### Lot 5 — Les sprites CGB et la table de priorités

**Objectif** : palette 0-7 (bits 0-2 des attributs OAM), banque de tuile (bit 3),
OBP0/OBP1 ignorés, et surtout **l'ordre de priorité**, qui n'est plus celui du DMG :
en CGB c'est l'index OAM qui tranche, pas la coordonnée X, sauf si OPRI (0xFF6C)
demande le comportement DMG.

**Le cœur du lot, et sa difficulté** : la priorité fond/sprite se décide par une
table à trois entrées — le bit 0 de LCDC (qui change de sens en CGB : il devient
un interrupteur de priorité, pas un interrupteur de fond), le bit 7 de l'attribut
de tuile, le bit 7 de l'attribut OAM. C'est la règle qu'on croit connaître et
qu'on n'a pas : elle sera écrite en table dans les TU, cas par cas.

**Oracle** : `cgb-acid2.gbc`, et cette fois comparé à l'image de référence.

---

### Lot 6 — HDMA (0xFF51-0xFF55)

**Objectif** : les deux transferts, général et cadencé sur HBlank. Ce n'est pas du
rendu, mais c'est rythmé par le PPU et la plupart des jeux CGB en dépendent pour
recharger tuiles et palettes en cours de trame.

**À décider à l'ouverture** : si le lot est nécessaire à `cgb-acid2` (il ne l'est
sans doute pas), il peut passer après le lot 5 sans rien bloquer.

---

### Lot 7 — Adjacents, hors PPU mais nécessaires pour jouer

Recensés ici pour qu'ils ne soient pas découverts au dernier moment, **pas
planifiés** : banques de WRAM (SVBK, 0xFF70), et le reste de l'IO CGB que
`boot_hwio-C.gb` et `unused_hwio-C.gb` arbitreront.

---

### Lot F — Le front *(à moi)*

Bascule DMG/CGB dans les Options, chemin couleur du `CanvasRenderer` et du
worker selon D1, et l'affichage du modèle actif dans l'overlay. Ne bloque aucun
lot du cœur ; se cale après le lot 3, quand la couleur sort réellement.

---

## 6. Explicitement hors portée

**Le double régime d'horloge (KEY1, 0xFF4D).** Ce n'est pas du PPU : il double
l'horloge CPU en laissant le PPU et l'APU à leur cadence, donc il touche le
modèle de temps de toute la machine — `totalCycles`, le timer, le curseur partagé
de l'APU. C'est un jalon à lui seul, à ouvrir après celui-ci, jamais pendant.

Sans lui, les jeux CGB tourneront — simplement à vitesse simple, comme un jeu qui
ne demanderait jamais la bascule.

---

## 7. Ce que j'attends de toi pour démarrer

1. **Trancher D1** (format du tampon écran) — j'ai recommandé A.
2. **Confirmer D2 et D3** (choix du modèle, noms des coutures).
3. **Déposer `cgb-acid2.gb`** dans `src/test/fixtures/` avant le lot 4.

Une fois D1-D3 figées, j'écris les TU du lot 0 et on démarre.
