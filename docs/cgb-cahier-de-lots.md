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

### Ce qui bloquait — **tout est levé** (lots 0 à 7)

Gardé pour mémoire : c'est cette liste qui a dicté le découpage.

| ce qui bloquait | levé par |
|---|---|
| `Fetcher` privé et instancié en dur | lot 0 — exporté, injecté au constructeur |
| Le coloriage recopié à trois endroits | lot 0 — `backgroundColor` / `spriteColor` |
| `screen` en teintes 0-3 | lot 3 — `Uint16Array` RGB555 (D1) |
| `bgLine` sans plan de priorité | lot 4 — `bgPriority` |
| `bus.ppuRead` incapable de viser une banque | lots 0 et 2 — `ppuReadBank` |
| 0xFF4C-0xFFFF en section plate | lot 1.5 (trous) puis 2 (`bindAddresses`) |

**Plus rien ne reste à router.** OPRI (0xFF6C) est arrivé au lot 5, HDMA
(0xFF51-55) au lot 6, SVBK (0xFF70) et les six registres indocumentés
(0xFF72-0xFF77) au lot 7. Tous par le même geste : leur propriétaire les DÉCLARE,
`bindAddresses` les route. La carte mémoire n'a toujours aucun « si CGB »
dedans — elle route ce qu'un propriétaire présent lui déclare, et en DMG ces
propriétaires n'existent simplement pas.

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

**Les deux sont FAITS.** Le harnais existe depuis le lot 0.5, et
`src/test/fixtures/reference.png` est arrivée pendant le lot 4 : c'est celle de
`cgb-acid2` (160x144, palette de 8 couleurs, en-tête « CGB ACID2 »). Elle est
décodée sans dépendance — `zlib` est dans Node — par `src/test/refPng.js`,
lui-même testé AVANT de servir de juge. `cgb-acid2` est donc devenu un
**cliquet** : un compte de pixels faux qui n'a plus le droit de remonter.

**P2 — `unused_hwio-C` n'est pas utilisable tant que `unused_hwio-GS` est rouge.**
Mesuré : la variante DMG échoue déjà aujourd'hui. Les deux ROMs testent le même
plan d'IO, la version `-C` n'y ajoute que `$FF4F`, `$FF68`, `$FF6A`, les registres
CGB indocumentés et le fait que `$FF4C` reste non mappé. Tant que la base DMG est
rouge, l'écart n'est pas lisible : on ne saurait pas si l'échec vient du CGB ou
d'un masque DMG manquant. **Fermer `unused_hwio-GS` est donc un prérequis**, et
c'est un trou de justesse DMG qu'on ne se connaissait pas.

### P3 — `unused_hwio-C` NE PEUT PAS devenir vert *(découvert au lot 7)*

Ce cahier a promis deux fois que les registres indocumentés étaient « tout ce qui
séparait cette ROM du vert ». **C'était faux**, et c'est le genre d'erreur que la
règle d'oracle est censée attraper : la conclusion venait de tests rejoués un par
un, pas de la ROM elle-même.

Une fois les six registres posés, elle avance — et s'arrête sur **`$FF69`**, le
port de DONNÉE des palettes de fond, qu'elle attend à 0xFF. L'explication est dans
son en-tête : `0x143 = 0x00`. Sur un vrai CGB, une cartouche qui ne se déclare pas
CGB fait démarrer la console en **mode de compatibilité DMG**, et le boot ROM y
verrouille tout un lot de registres — `$FF69` et `$FF6B` (les données de palette),
`$FF6C` (OPRI), `$FF70` (SVBK), les cinq du HDMA, et `$FF74` qui devient lecture
seule à 0xFF. Pandocs le dit noir sur blanc pour `$FF74` : *« Otherwise, this
register is read-only, and locked at value $FF »*.

Ce que cette ROM a mesuré sur du matériel, c'est donc **un CGB bridé**. Nous la
forçons en modèle CGB — la seule façon d'atteindre les registres qu'elle arbitre
par ailleurs. Les deux lectures ne peuvent pas être vraies en même temps.

Le test a donc changé de nature plutôt que de disparaître : il assure désormais
**jusqu'où** elle va, en lisant le registre fautif dans sa propre HRAM
(`test_reg`, 0xFF83). Reculer avant `$FF69`, c'est casser un lot déjà fermé.

### État mesuré des oracles — après le lot F

| ROM | état | rôle |
|---|---|---|
| `boot_regs-dmgABC.gb` | **passe** en DMG, échoue en CGB | lot 1, avec son négatif |
| `boot_regs-cgb.gb` | **passe** en CGB, échoue en DMG | lot 1, avec son négatif |
| `unused_hwio-GS.gb` | **passe** | fermé au lot 1.5 |
| `unused_hwio-C.gb` | s'arrête à `$FF69` | **plafond**, voir P3 |
| `dmg-acid2.gb` | instantané stable | filet du rendu DMG |
| `cgb-acid2.gbc` + `reference.png` | **0 pixel faux sur 23040** | **verdict**, lot 5 |
| `hblank_vram_dma.gbc` | **passe** (écran vert) | lot 6 |
| `bg_oam_priority.gbc` | **passe** | lot 5 |
| `oam_internal_priority.gbc` | **passe** | lot 5 |
| `boot_hwio-C.gb` | échoue, non exploité | mesure le CGB bridé (P3) |
| `vblank_stat_intr-C.gb` | jamais mesuré | appoint, non planifié |

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
| `cgb-acid2.gbc` | **oui** (déposée au lot 4) | le rendu CGB entier |
| `reference.png` | **oui** (déposée au lot 4) | l'image juste de `cgb-acid2` |
| `magen/hblank_vram_dma.gbc` | **oui** (lot 6) | le HDMA HBlank, et son gel en `halt` |
| `magen/bg_oam_priority.gbc` | **oui** (lot 5) | la table de priorités, cas par cas |
| `magen/oam_internal_priority.gbc` | **oui** (lot 5) | l'ordre entre objets, en CGB |

> **Le manque est comblé.** Les lots 4 et 5 ont désormais un vrai verdict, et non
> une simple mesure d'écart. Ce qui reste vrai en revanche : les TU intermédiaires
> sont écrits contre pandocs, donc verts parce qu'ils encodent MA lecture. C'est
> précisément pour ça que la table de priorités du lot 5 doit être arbitrée par la
> ROM et pas par mes tests.

**Les trois ROMs `magen/` ont été récupérées pendant les lots 5 et 6**
(github.com/alloncm/MagenTests, MIT, v0.5.0 — le LICENSE est déposé à côté
d'elles). Elles rendent leur verdict EN IMAGE, et chacune vise une règle et une
seule : là où `cgb-acid2` dit « quelque chose est faux quelque part », elles
disent laquelle. Sans elles, le lot 6 serait parti sans aucun oracle du tout —
c'est exactement le cas que §3 nommait comme le plus dangereux.

---

## 4. Décisions à trancher AVANT le premier test

Conformément à la règle du projet : on fige les noms et les signatures **avant**
que j'écrive la moindre TU, sinon les tests figent une interface qu'on regrette.

### D1 — Le format du tampon écran — **TRANCHÉE : option A**

Aujourd'hui `screen` est un `Uint8Array(160*144)` de teintes 0-3, que
`CanvasRenderer` traduit par une table de 4 couleurs. Le CGB rend du RGB555.

| option | contenu de `screen` | conséquence |
|---|---|---|
| **A — RGB555 unifié** | `Uint16Array`, 0bxBBBBBGGGGGRRRRR | DMG et CGB sortent le même format ; le DMG traverse sa palette de 4 teintes dans le PPU. Le front ne connaît plus qu'un seul cas. **Change le contrat DMG.** |
| **B — deux plans** | `screen` (teinte) + `paletteLine` (n° de palette) | Ne touche pas le DMG, mais le front doit refaire la résolution de couleur, et les tests DMG existants restent valides tels quels. |
| **C — deux tampons** | `screen` en DMG, `screenRGB` en CGB | Aucun risque de régression, mais deux chemins à maintenir dans le worker, le renderer et le profileur. |

**Retenue : A.** Appliquée au lot 3, confirmée après coup. `screen` est un
`Uint16Array` de RGB555 pour les deux modèles ; le DMG traverse ses quatre verts
dans le PPU (`DMG_COLORS`), et `CanvasRenderer` n'a plus qu'un chemin — une table
RGB555 -> RGBA de 32 768 entrées bâtie une fois, sans « si CGB ».

**Les instantanés de rendu sont restés identiques à l'octet près** au moment de
la bascule : la preuve que rien de ce qui est dessiné n'a bougé, seul son
encodage. Une trentaine d'assertions de `ppu.test.js` ont été portées — portées,
jamais supprimées.

### D2 — Le choix du modèle — **TRANCHÉE** *(lot 1)*

Livré, avec deux écarts sur la proposition initiale :

- l'en-tête expose `cgbFlag`, `supportsCgb` (bit 7) et `isCgbOnly` (0xC0) — trois
  getters plutôt qu'un `isCgb`, parce que 0x80 et 0xC0 ne disent pas la même chose ;
- le modèle est celui de la **console**, pas de la cartouche : une cartouche 0x80
  dans une DMG tourne en DMG. D'où `dmg` / `cgb` / `auto`, `auto` étant la seule
  qui consulte l'en-tête. Défaut : `dmg` ;
- la préférence passe par le **constructeur de `Machine`**, pas par l'usine : deux
  appelants lui passaient déjà un sixième argument qu'elle ignore.

Fait qui a tranché tout seul : `boot_regs-cgb.gb` porte 0x143 = 0x00. Les ROMs
mooneye ne se déclarent JAMAIS CGB — le forçage manuel est la condition pour
faire tourner l'oracle, pas un confort.

### D3 — Nommage des coutures — **FIGÉ** *(lots 0, 2 et 4)*

Ce qui existe réellement. Un seul écart sur la proposition : `createFetcher()` a
été remplacé par une **injection au constructeur**, sans valeur par défaut.

```
// lot 0
Fetcher                          // exporté, injecté : new PPU(FetcherClass)
tileAttributes(mapAddress)       // DMG : 0 ; CGB : l'octet de la banque 1
backgroundColor(shade, attrs)    // le coloriage du fond, un seul endroit
spriteColor(shade, sprite)       // le coloriage des sprites
spriteOrder(visibles)            // DMG : x puis index ; CGB (OPRI) : index seul
buildRegistersMapping()          // surchargeable ; bâtie à la 1re demande
bus.ppuReadBank(addr, bank)      // lecture visant une banque de VRAM

// lot 2
vramRead / vramWrite(addr)       // le CPU, qui suit VBK
vramReadBank(addr, bank)         // le PPU, qui vise
memory.bindAddresses(...)        // router des adresses éparses

// lot 4
tileAddress(id)                  // l'adressage 0x8000 / signé, un seul endroit
patternRow(row, attrs)           // miroir vertical
patternBank(attrs)               // banque du motif — un NUMÉRO, pas un booléen
patternBit(column, attrs)        // miroir horizontal
tilePriority(attrs)              // alimente le plan bgPriority

// lot 5
backgroundVisible()              // LCDC bit 0 : DMG l'éteint, CGB le déclasse
blankLine(line)                  // décor coupé : blanc, ET transparent aux objets
spriteBank(sprite)               // banque du motif d'objet (bit 3 de l'OAM)
spriteOverBackground(sprite, x)  // la table de priorités, un seul endroit

// lot 6
enterHBlank()                    // le souffle de fin de ligne ; le CGB y porte son HDMA
```

**Règle apprise à la dure** : une couture qui rend un NUMÉRO utilise `byte.getBit`,
une couture qui rend une CONDITION garde `byte.getFlag`. Mélanger les deux a fait
lire le motif dans la mauvaise banque, en silence.

---

## 5. Les lots

Chaque lot suit la même boucle : **concept + analogie -> TU -> code jusqu'au
vert -> on ferme.** Un lot ne s'ouvre qu'une fois le précédent fermé, et aucun
n'a le droit de faire rougir les tests existants — **1746 au dernier compte**.

*(Sur tout ce jalon, tu m'as demandé de coder aussi bien les TU que
l'implémentation, contrairement à la répartition habituelle du projet.)*

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

### Lot 0.5 — Le harnais de rendu — **FERMÉ** *(prérequis P1)*

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

### Lot 2 — La VRAM double et VBK — **FERMÉ**

**Objectif** : deux banques de 8 Ko, commutées par 0xFF4F, et un PPU capable de
lire une banque précise sans passer par la commutation.

**Le piège à ne pas manquer** : les règles de blocage par mode (le `read != write`
dot-précis du chapitre PPU) s'appliquent **aux deux banques**. Ce lot ne doit pas
les contourner en tapant `memory._read` directement.

**TU** : écriture/lecture par banque ; en DMG l'écriture de VBK est sans effet ;
le blocage mode 3 reste intact.

**Oracle** : `unused_hwio-C.gb` arbitre nommément `$FF4F`. Il reste ROUGE — les
palettes manquent encore — mais son test `$FF4F` passe désormais.

**Ce que le lot a appris :**

- **VBK est un aiguillage CÔTÉ PROCESSEUR, et lui seul.** Le PPU ne le consulte
  jamais : il lit la carte en banque 0 et son étiquette en banque 1 dans le même
  souffle. Confondre les deux ferait clignoter le fond au rythme des écritures
  du jeu. D'où deux chemins distincts : `vramRead` (le CPU, qui suit VBK) et
  `vramReadBank` (le PPU, qui vise).
- **La banque 0 reste dans la mémoire plate.** Seule la banque 1 est un tampon à
  part. Tout le reste de l'émulateur — le DMA, le PPU DMG, les tests — continue
  de lire la VRAM par `memory._read` sans rien savoir de cette histoire.
- **Le PPU DÉCLARE ses registres, `MemoryBuilder` les lui route** (`bindAddresses`).
  0xFF4F tombe hors de la plage historique 0xFF40-0xFF4B, au milieu des trous
  fermés au lot 1.5 : plutôt qu'une carte mémoire par modèle, qui divergerait au
  premier ajout, la table du PPU fait foi. Les palettes du lot 3 arriveront
  gratuitement par le même chemin.
- **La section VRAM délègue au PPU** au lieu de taper la mémoire plate — après
  le verrou de mode, jamais avant : le blocage dot-précis conquis au chapitre PPU
  s'applique aux DEUX banques.

Le PPU CGB existe donc, et n'est qu'une sous-classe : il ne redéfinit que la
VRAM et sa table de registres. Le trajet du pixel n'a pas bougé d'un iota.

---

### Lot 3 — Les palettes CGB et la sortie couleur — **FERMÉ**

**Objectif** : 0xFF68-0xFF6B (BCPS/BCPD/OCPS/OCPD), deux fois 64 octets de RAM de
palette, auto-incrément sur le bit 7 de l'index, et le RGB555 qui en sort.

**TU** : l'auto-incrément avance après une écriture et **pas** après une lecture ;
relecture fidèle ; décodage RGB555 ; huit palettes de quatre couleurs de chaque
côté ; en DMG ces registres n'existent pas.

**Oracle** : `unused_hwio-C.gb` arbitre `$FF68` et `$FF6A`. **Ses trois entrées
qui relèvent du PPU passent maintenant** — vérifié en les rejouant une par une :

```
$FF4F  OK      $FF68  OK      $FF6A  OK      $FF4C (non mappé)  OK
$FF72  ECHEC   $FF75  ECHEC   $FF76  ECHEC   $FF77  ECHEC
```

Ce qui reste rouge est le lot des quatre registres CGB **indocumentés**, hors
PPU : c'est du lot 7, et c'est tout ce qui sépare `unused_hwio-C` du vert.

**D1 est tranchée : RGB555 unifié.** `screen` est un `Uint16Array` pour les deux
modèles, le DMG traverse ses quatre verts DANS le PPU, et `CanvasRenderer` n'a
plus qu'un seul chemin — une table de 32 768 entrées bâtie une fois, sans « si
CGB ». **Les instantanés de rendu sont restés identiques à l'octet près** : la
meilleure preuve possible que la décision n'a rien changé à ce qui est dessiné,
seulement à son encodage. Réversible si tu préfères une autre option.

**Le piège du lot** : l'auto-incrément n'avance QU'À L'ÉCRITURE. Un curseur qui
avancerait aussi en lecture décalerait toutes les palettes d'un cran dès qu'un
jeu relit ce qu'il vient d'écrire — et ça ne se voit qu'à l'image, longtemps
après. Un test le tient.

Les palettes ne sont pas encore CÂBLÉES au rendu : c'est le lot 4 (fond) et le
lot 5 (sprites) qui iront y chercher leurs couleurs.

---

### Lot 4 — Les étiquettes de tuile et le fond CGB — **FERMÉ**

**Objectif** : le fetcher lit l'octet d'attribut dans la banque 1, à la même
adresse que l'identifiant de tuile dans la banque 0, et l'applique : palette 0-7,
banque de la tuile, miroir X, miroir Y, bit de priorité.

**Ce qui change dans le trajet du pixel** : rien, sauf que `tileAttributes` ne rend
plus 0. C'est là que le lot 0 se paie.

`bgLine` gagne son plan de priorité (le bit 7 de l'étiquette), sans lequel le lot 5
ne peut pas trancher.

**TU** : chaque bit de l'attribut isolément, puis en combinaison (miroir X + Y).

**Oracle** : `cgb-acid2.gbc` **contre l'image de référence**, désormais présente
(`src/test/fixtures/reference.png`, décodée sans dépendance). Elle devient un
CLIQUET : on ne peut pas exiger zéro avant le dernier lot, mais on exige que le
compte de pixels faux ne REMONTE jamais.

```
avant le lot 4   ~100 %   (aucune couleur CGB)
étiquettes        29,1 %   6716 / 23040
+ correction de la banque   28,1 %   6476 / 23040
```

**Le bug que le lot a révélé, et qui n'aurait pas fait de bruit** : `byte.getFlag`
rend un BOOLÉEN, et `vramReadBank` compare `bank === 1` strictement. `true !== 1`,
donc le motif revenait silencieusement de la banque 0 — un fond juste assez
plausible pour ne rien voir à l'œil. La comparaison stricte est restée telle
quelle : c'est elle qui a fait tomber le test. Les coutures qui rendent un
NUMÉRO utilisent `getBit`, celles qui rendent une condition gardent `getFlag`.

Les 28 % restants sont attendus : les sprites portent encore des couleurs DMG.
C'est le lot 5.

---

### Lot 5 — Les sprites CGB et la table de priorités — **FERMÉ**

**Objectif** : palette 0-7 (bits 0-2 des attributs OAM), banque de tuile (bit 3),
OBP0/OBP1 ignorés, et l'ordre de priorité, qui n'est plus celui du DMG : en CGB
c'est l'index OAM qui tranche, sauf si OPRI (0xFF6C) réclame le comportement DMG.

**Résultat : `cgb-acid2` passe de 28,1 % de pixels faux à ZÉRO.** Le cliquet est
donc devenu un verdict, et le rendu CGB n'est plus « plausible » : il est celui
d'un vrai CGB, pixel pour pixel.

**Les deux pistes du cahier étaient les bonnes, et c'était le même bug.** La
teinte de remplissage en (32,0) et la bande verte qui barrait l'écran de la ligne
56 à la 87 avaient la même cause : `renderFifo` blanchissait la ligne quand LCDC
bit 0 était bas. En CGB ce bit ne coupe pas le décor, il lui retire seulement sa
priorité. À lui seul, ce blanchiment valait 5 120 des 6 476 pixels faux — et il
cachait au passage le « HELLO WORLD! » du haut de l'image.

**Le trou de justesse DMG trouvé en démêlant les deux sens du bit** : `renderFifo`
rendait la main AVANT de dessiner les objets quand le décor était coupé. Pandocs
est explicite — *« Only objects may still be displayed »*. Le DMG a donc gagné
un correctif au passage, et `dmg-acid2` n'a pas bougé d'un pixel (la ROM ne coupe
jamais son décor : le bug ne se voyait pas, il attendait).

**La règle contre-intuitive, celle qu'on n'aurait pas devinée** : la priorité
ENTRE OBJETS se résout AVANT qu'on regarde le fond. Le PPU retient d'abord un
pixel d'objet par colonne — le premier opaque dans l'ordre de priorité, sans
jamais consulter le bit « BG over OBJ » — et ce n'est qu'ensuite qu'il demande à
CE pixel-là s'il passe devant le décor. Conséquence : un objet prioritaire qui
perd contre le décor **masque** ceux de derrière au lieu de leur céder la place.
`renderSprites` est donc en deux temps, avec un plan `objLine`/`objOwner`.

**TU** : la table de priorités écrite en table (huit combinaisons × la teinte de
fond), l'ordre OAM contre l'ordre X, OPRI dans les deux sens, le masquage dans
les deux modèles, et les deux sens de LCDC bit 0.

**Oracles, et il y en a trois** :

| ROM | ce qu'elle arbitre |
|---|---|
| `cgb-acid2.gbc` contre `reference.png` | 0/23040 — le rendu entier |
| `magen/bg_oam_priority.gbc` | 5 carrés verts, 3 mi-verts mi-bleus, aucune ligne rouge |
| `magen/oam_internal_priority.gbc` | deux paires de triangles qui se TOUCHENT |

La dernière mérite un mot : ses deux triangles ne se recouvrent que là où le motif
prioritaire est TRANSPARENT. Un PPU qui réserverait la colonne à l'objet
prioritaire sans regarder si son pixel est opaque laisserait un trou blanc entre
les deux. C'est exactement le piège du paragraphe précédent, isolé dans six
pixels.

---

### Lot 6 — HDMA (0xFF51-0xFF55) — **FERMÉ**

**Objectif** : les deux transferts, général et cadencé sur HBlank. Ce n'est pas du
rendu, mais c'est rythmé par le PPU et la plupart des jeux CGB en dépendent pour
recharger tuiles et palettes en cours de trame.

**L'analogie** : un déménagement. Le transfert général, c'est le camion qui part
une fois, plein, et le programme attend qu'il revienne. Le transfert HBlank, c'est
le même chargement porté carton par carton — 16 octets à chaque fois que le PPU
souffle en fin de ligne — et le jeu continue de tourner entre deux cartons.

**Le cahier annonçait « aucun oracle » : c'était vrai des fixtures, pas du
monde.** `hblank_vram_dma.gbc` (MagenTests) a été récupérée pour ce lot, et c'est
un très bon juge : elle peint l'écran en ROUGE, lance un transfert HBlank qui le
repeint en VERT, attend en scrutant HDMA5, puis en lance un second en BLEU et se
met immédiatement en `halt`. Trois choses tombent d'un coup — le transfert
existe, HDMA5 se relit, et le `halt` le gèle. Elle était **rouge** avant le lot,
elle est **verte** après.

**Les deux règles qui ne se devinent pas**, et que cette ROM sanctionne :

- il n'y a pas de HBlank en VBlank. Rien ne bouge aux lignes 144-153 — chez nous
  c'est gratuit, le mode 1 ne traverse jamais le mode 3, donc jamais
  `enterHBlank()` ;
- **le CPU en `halt` gèle le transfert**. Le DMA emprunte le bus au PROCESSEUR,
  pas au PPU : processeur endormi, plus personne pour porter les cartons.

**Le piège du registre à deux usages** : le même bit 7 à 0 écrit dans HDMA5
DÉMARRE un transfert général quand rien ne tourne, et INTERROMPT le transfert
HBlank en cours quand il y en a un. Un TU tient chacun des deux sens.

**Une simplification assumée** : le transfert général est instantané et ses cycles
ne sont pas facturés au CPU (8 cycles machine par bloc sur le vrai matériel).
C'est le même choix que le DMA d'OAM (0xFF46) depuis toujours. Un jeu y gagne un
peu de temps de VBlank qu'il n'aurait pas eu.

**La source passe par `memory.read`, pas par `_read`.** Elle est presque toujours
en ROM, donc derrière le MBC et sa banque courante ; la mémoire plate y rendrait
des zéros. *(Le DMA d'OAM, lui, lit toujours par `_read` : une copie depuis la ROM
y rendrait zéro. Personne ne s'en plaint parce que les jeux copient l'OAM depuis
la WRAM — c'est un défaut connu, hors de ce jalon.)*

---

### Lot 7 — Adjacents, hors PPU mais nécessaires pour jouer — **FERMÉ**

Deux choses distinctes, et un nouveau propriétaire pour les deux :
`core/cgb/index.js`. Les registres CGB déjà posés étaient tous du ressort de
l'affichage, et c'est le PPU qui les déclare ; ceux-ci ne le sont pas. Ils ont
donc leur propre propriétaire, bâti sur le même modèle — il déclare une table,
la mémoire route ce qui est déclaré, et rien dans la carte mémoire ne teste le
modèle.

**a) Les registres indocumentés — ils sont SIX, pas quatre.** Le cahier en
comptait quatre parce qu'il ne listait que ceux qui échouaient à ce moment-là :

```
$FF72, $FF73, $FF74   lecture/écriture libres, 0x00 au départ
$FF75                 seuls les bits 4-6 se retiennent (relu 0b1000_1111)
$FF76, $FF77          PCM12 / PCM34
```

Et **les deux derniers ne sont plus indocumentés du tout** : PCM12 et PCM34
rendent la sortie NUMÉRIQUE des quatre voies de l'APU, un quartet par voie, la
voie impaire en bas. Ce n'est pas un registre à ranger quelque part, c'est une
fenêtre : rien n'est stocké, on lit l'APU à l'instant où le CPU demande. Notre APU
sait déjà donner l'amplitude d'une voie à une date (`channelN.amplitude(cycle)`),
donc les câbler coûtait moins cher que de les truquer à zéro.

**Ce lot n'a PAS fermé `unused_hwio-C`**, contrairement à ce qui était promis
ici : voir le prérequis P3 en §3. Il l'a fait avancer jusqu'à `$FF69`, et c'est un
plafond de nature, pas de travail.

**b) Les banques de WRAM (SVBK, 0xFF70).** Sept banques de 4 Ko en 0xD000-0xDFFF,
la moitié basse (0xC000) ne bougeant jamais. Même geste qu'au lot 2 pour la VRAM :
**la banque 1 reste dans la mémoire plate**, seules les banques 2 à 7 sont des
tampons à part. Tout le reste de l'émulateur continue de lire 0xD000 sans rien
savoir de cette histoire. La banque 0 demandée donne la banque 1 — il n'y a pas de
banque 0 en haut.

Sans effet sur `cgb-acid2`, mais sans elle un jeu CGB se cogne à un plafond de
8 Ko de RAM.

---

### Lot F — Le front *(à moi)* — **FERMÉ**

**Déjà fait au lot 3** : le chemin couleur de `CanvasRenderer` (table RGB555 ->
RGBA, un seul chemin pour les deux modèles). Le worker n'a rien demandé — il
transfère `ppu.screen` sans en connaître le type.

**Fait au lot F** :

- **la bascule Auto / DMG / CGB** dans les Options, persistée comme la coque et le
  débogage (`emugbc.model`), et transmise au worker dans le message `load` ;
- **l'affichage du modèle actif** dans l'overlay, à côté du `WK`/`MT`. C'est le
  modèle RÉSOLU qui s'affiche, pas le réglage : en « auto », seule la machine sait
  ce qu'elle est devenue, et elle est de l'autre côté du `postMessage` — d'où un
  message `{ type: 'model' }` en retour ;
- **le sélecteur de fichiers accepte les `.gbc`.** Il ne prenait que `.gb` : un jeu
  couleur ne pouvait littéralement pas être choisi dans la boîte de dialogue. Le
  reste du lot n'aurait servi à rien sans ça.

**Le défaut est `auto`, et pas `dmg`.** C'est le comportement d'une vraie console :
la cartouche dit ce qu'elle sait faire, le boîtier suit. Le défaut du CŒUR reste
`dmg` (le constructeur de `Machine`), parce que toutes les ROMs de test s'appuient
dessus — c'est le front qui demande `auto`, pas la machine qui l'a adopté.

**Deux collisions rencontrées, notées pour la prochaine fois** : une des coques
s'appelle « DMG », donc chercher un bouton par son nom trouvait la coque ET le
modèle (les tests interrogent le `fieldset` par son `legend`) ; et l'étiquette du
sélecteur, `Cartouche (.gb)`, était le point d'accroche de sept tests existants —
portés, pas supprimés.

---

## 6. Explicitement hors portée

**Le double régime d'horloge (KEY1, 0xFF4D).** Ce n'est pas du PPU : il double
l'horloge CPU en laissant le PPU et l'APU à leur cadence, donc il touche le
modèle de temps de toute la machine — `totalCycles`, le timer, le curseur partagé
de l'APU. C'est un jalon à lui seul, à ouvrir après celui-ci, jamais pendant.

Sans lui, les jeux CGB tourneront — simplement à vitesse simple, comme un jeu qui
ne demanderait jamais la bascule. **Un point de vigilance quand même, découvert au
lot 7** : `$FF4D` n'est pas mappé du tout, donc il se lit 0xFF. Un jeu qui teste
son bit 7 pour savoir à quelle vitesse il tourne lira « double vitesse ». Un vrai
CGB au repos rend 0x7E. Poser ce seul octet est tentant, mais il ne va pas seul :
un jeu qui arme la bascule puis exécute `STOP` attendrait un changement de régime
qui ne viendrait jamais. C'est le premier caillou du jalon suivant, pas un
correctif isolé.

**Le mode de compatibilité DMG (KEY0, 0xFF4C).** Découvert au lot 7 en cherchant
pourquoi `unused_hwio-C` refusait de finir — voir P3. Un CGB qui reçoit une
cartouche non-CGB se bride lui-même : palettes figées par le boot ROM, données de
palette, OPRI, SVBK et HDMA verrouillés, `$FF74` en lecture seule. C'est ce que
mesurent `unused_hwio-C` et `boot_hwio-C`, et c'est pour ça qu'aucune des deux ne
peut devenir verte ici. Émuler ce mode est un petit jalon en soi ; il n'apporte
rien au rendu et ne débloque aucun jeu, seulement deux oracles.

---

## 7. Où on en est

**Le jalon est fermé.** Lots 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7 et F.
**1746 tests au vert**, dont 1664 côté cœur.

Le verdict du jalon tient en une ligne : **`cgb-acid2` rend l'image de référence
au pixel près, 0 faux sur 23040**, et les trois ROMs MagenTests passent.

| ce qui a été fait | où ça se vérifie |
|---|---|
| deux banques de VRAM, VBK | `unused_hwio-C` (`$FF4F`), `cgb-vram.test.js` |
| palettes, RGB555 unifié | `unused_hwio-C` (`$FF68`, `$FF6A`), `cgb-acid2` |
| étiquettes de tuile, fond couleur | `cgb-acid2` |
| sprites, table de priorités, OPRI | `cgb-acid2`, `bg_oam_priority`, `oam_internal_priority` |
| HDMA général et HBlank | `hblank_vram_dma` |
| SVBK, registres indocumentés, PCM | `cgb-systeme.test.js`, `unused_hwio-C` jusqu'à `$FF69` |
| bascule DMG/CGB côté front | `modele-front.test.jsx` |

**Ce qui reste ouvert, et qui n'est pas de ce jalon** : le double régime d'horloge
(KEY1) et le mode de compatibilité DMG (KEY0), tous deux en §6. Le premier est le
prochain jalon naturel — c'est lui qui manquera à un vrai jeu CGB, pas les
deux oracles que le second débloquerait.

**La leçon du jalon**, s'il faut n'en garder qu'une : la règle d'oracle du §3 a
tenu, et elle a servi deux fois plutôt qu'une. Elle a évité le brouillard des
quatre suspects — mais surtout, elle a fini par retourner une promesse que ce
cahier répétait sans l'avoir vérifiée (P3). Un oracle ne sert pas seulement à
valider le code : il valide aussi ce qu'on croit savoir de l'oracle.
