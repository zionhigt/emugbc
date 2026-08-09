# Double vitesse (KEY1) — cahier de lots

> **Objectif du jalon** : qu'un jeu CGB puisse doubler son horloge processeur, et
> que tout le reste de la machine continue de tourner à la vitesse du monde.
>
> **Contrainte de conception, posée d'entrée** : on n'accélère rien. Il n'y a pas
> de « mode rapide » à écrire — il y a **deux horloges** là où le code n'en
> connaît qu'une, et tout le travail consiste à démêler laquelle chaque
> périphérique regardait déjà sans le savoir.

---

## 1. L'idée directrice

Aujourd'hui `machine.totalCycles` sert de temps à tout le monde : le CPU le fait
avancer en payant ses instructions, et le PPU, le timer et l'APU s'en servent
pour savoir où ils en sont. C'est juste — tant qu'il n'y a **qu'une** horloge.

Le CGB en a deux. Quand le double régime est enclenché, le processeur bat deux
fois plus vite ; l'écran, lui, continue d'afficher 59,7 images par seconde, et le
haut-parleur continue de sortir un la à 440 Hz. Autrement dit :

```
vitesse simple :  1 cycle CPU = 1 cycle système
vitesse double :  1 cycle CPU = ½ cycle système
```

### L'analogie pour tenir le cap

**Deux montres, une seule aiguille affichée.** Jusqu'ici le CPU et le monde
portaient la même montre, alors on n'en montrait qu'une. Le double régime met une
seconde montre au poignet du processeur, qui tourne deux fois plus vite — et la
question, pour chaque périphérique, devient : *tu regardes laquelle ?*

| périphérique | montre |
|---|---|
| CPU | la sienne, qui accélère |
| Timer et DIV | celle du CPU (ils comptent son horloge) |
| Port série | celle du CPU |
| DMA vers l'OAM | celle du CPU |
| **PPU / LCD** | **celle du monde** |
| **HDMA vers la VRAM** | **celle du monde** |
| **APU — toutes les fréquences** | **celle du monde** |

Retiens cette table, elle décide de tout le découpage : **rien ne va plus vite,
c'est le processeur qui bat plus souvent entre deux battements du monde.**

Et le cas retors, celui qui mérite d'être nommé tout de suite : **le séquenceur
de trames de l'APU regarde les deux à la fois.** Il est cadencé par DIV — la
montre du CPU — mais il doit rester à 512 Hz dans le monde réel. Le matériel
résout ça en changeant de bit : DIV bit 4 en vitesse simple, **bit 5** en vitesse
double.

*(Chez nous ce n'est finalement pas une période qui double, comme annoncé ici,
mais une SECONDE ORIGINE notée sur la montre du monde : le compteur du timer est
remis à zéro aux mêmes instants sur les deux montres, et chacun lit la sienne.
Voir le lot 4 — c'est là qu'un vrai bug attendait.)*

---

## 2. État des lieux

### Ce sur quoi on s'appuie

| acquis | où |
|---|---|
| Le jalon CGB entier, `cgb-acid2` au pixel près | `docs/cgb-cahier-de-lots.md`, CLOS |
| Un propriétaire pour les registres CGB hors PPU | `core/cgb/index.js` (lot 7) |
| PPU dot-précis dérivé de l'horloge, un seul point d'entrée | `ppu.totalMachineCycles` |
| APU dérivé de l'horloge, un seul point d'entrée | `apu.totalMachineCycles` |
| Timer au cycle, migration terminée | `core/timer/index.js` |
| `cpu.stop(n8)` existe déjà, et ne fait rien d'utile | `CPU.js:175` |

**Le point d'appui décisif** : le PPU et l'APU passent TOUS LES DEUX par un
getter unique, `totalMachineCycles`, pour connaître l'heure. Deux lignes à
changer, et ils regardent l'autre montre. Ce n'est pas un hasard — c'est ce que
la migration au cycle a laissé derrière elle.

### Ce qui bloque

| ce qui bloque | levé par |
|---|---|
| Une seule horloge pour tout le monde | lot 0 — `machine.systemCycles` |
| `0xFF4D` n'est pas mappé : il se lit 0xFF | lot 1 — KEY1 chez `core/cgb/` |
| `cpu.stop()` lève un drapeau que personne ne lit | lot 1 |
| Le séquenceur APU lit une date du monde contre une origine du CPU | lot 4 — `innerSystemCyclesAt` |

### Le piège qui se lit déjà dans le code existant

`$FF4D` se lit aujourd'hui **0xFF**, parce qu'il tombe dans les trous. Un jeu qui
teste son bit 7 pour savoir à quelle vitesse il tourne lit donc « déjà en double
vitesse » et **ne demande jamais la bascule**. C'est confortable par accident :
tant que le jalon n'est pas fait, les jeux ne réclament rien. Ça cesse d'être
vrai à la seconde où on mappe le registre — d'où l'ordre des lots ci-dessous, qui
mappe KEY1 et fait la bascule **dans le même lot**.

---

## 3. La règle d'oracle

Reprise telle quelle du jalon CGB (§3 de son cahier), parce qu'elle a payé :
*chaque lot finit sur quelque chose d'extérieur à ma tête, qui ne peut être vert
que si CE lot est juste.*

Et cette fois **les oracles sont là avant le premier test**, ce qui n'était pas
le cas au lot 6 du jalon précédent.

### Les oracles, déposés et mesurés

`src/test/fixtures/age/speed-switch/` — huit ROMs du dépôt
[age-test-roms](https://github.com/c-sp/age-test-roms) (MIT, le LICENSE est
déposé à côté), écrites précisément pour la bascule de vitesse. Elles suivent le
protocole mooneye : à la fin, `LD B,B`, et les registres portent la suite de
Fibonacci `B=3 C=5 D=8 E=13 H=21 L=34` si le test réussit.

| ROM | ce qu'elle arbitre | lot |
|---|---|---|
| `spsw-stop-prefetch-cgbBCE.gb` | ce que `STOP` avale exactement | 1 |
| `spsw-mode0-cgbBCE.gb` | les modes du PPU en travers d'une bascule | 2 |
| `spsw-div-cgbBCE.gb` | DIV en travers d'une bascule | 3 |
| `spsw-tima-cgbBC.gb`, `-cgbE.gb` | TIMA en travers d'une bascule | 3 |
| `spsw-ch2-lc-delay-cgbBCE.gb` | le compteur de longueur de la voie 2 | 4 |
| `caution/spsw-interrupts-cgbBC.gb`, `-cgbE.gb` | les IRQ pendant l'arrêt | 5 |

**État de départ, mesuré avant d'écrire une ligne** : les huit échouent, toutes
de la même façon — `regs=[0,107,20,6,152,16]`, PC figé à `0x12D0`.

*(Deux corrections apportées depuis, et elles comptent pour la suite.* `0x12D0`
n'est pas un `STOP` qui bloque : c'est la boucle de parking `EI / HALT / JR` que
ces ROMs exécutent APRÈS avoir rendu leur verdict — elles allaient au bout depuis
le début, elles échouaient simplement. *Et cette uniformité n'est pas une
signature commune* : les huit convergent vers le même épilogue d'échec, qui écrit
« TEST FAILED! » à l'écran et pose ses propres registres. Les registres lus à la
fin ne disent donc rien de l'endroit où chacune a échoué.*)*

**Comment on les a réellement lues, à partir du lot 3** : pas en fouillant leur
binaire, mais **en lisant leur source** (`.asm` et `.inc` du dépôt AGE) puis en
rejouant leur séquence exacte dans un banc à nous. C'est ce qui a permis de dire
« notre marche est à 62, la ROM l'attend à 61 » au lieu de « c'est rouge ». Une
ROM qui rend un verdict binaire ne localise rien ; sa SOURCE, elle, dit ce
qu'elle attend et à quel cycle.

### Deux ROMs portent un avertissement, et il est à lire

`caution/spsw-interrupts-*` **écourtent volontairement** la période d'arrêt qui
suit `STOP`. Le dépôt prévient que son auteur a rendu une vraie console instable
en les enchaînant. Ça ne nous coûte rien en émulation, mais ça dit ce que ces
deux-là mesurent : un cas limite hors des clous du manuel Nintendo. Elles sont au
lot 5, en dernier, et leur échec ne bloquerait pas le jalon.

### Le filet, en plus des oracles

Le double régime touche le modèle de temps de TOUTE la machine. Les trois suites
déjà vertes deviennent donc le vrai garde-fou : **blargg `cpu_instrs` 11/11**,
**blargg `dmg_sound` 12/12**, **mooneye PPU 12/12**, plus les instantanés
`dmg-acid2` et `cgb-acid2`. Aucun lot n'a le droit de les faire bouger — et le
lot 0 ne se juge QU'À ÇA.

---

## 4. Décisions à trancher AVANT le premier test

### D1 — Où vit le temps système — **proposition : A**

| option | comment | conséquence |
|---|---|---|
| **A — un second compteur sur la Machine** | `machine.systemCycles`, avancé en même temps que `totalCycles`, d'un demi-pas en vitesse double | Deux lignes changent (les getters du PPU et de l'APU). Le reste du code ne sait rien. Un compteur de plus à tenir cohérent. |
| B — convertir chez chaque consommateur | chacun demande `machine.toSystem(cycle)` | Pas de second état, mais la conversion se répète, et une conversion oubliée est un bug silencieux. |
| C — le CPU paie en cycles système | le timer scale à la place | Renverse le sens historique de `totalCycles` : tout le CPU et tout le timer sont à relire. Trop de surface pour ce qu'on gagne. |

**Retenue : A.** C'est celle qui rend le lot 0 démontrable — en vitesse simple les
deux compteurs sont égaux, donc « rien ne bouge » est vérifiable à l'octet près.

**Le demi-pas** : en vitesse double un cycle CPU vaut un demi cycle système. On
compte donc en DEMIS (`_systemHalfCycles`, entier) et on rend la moitié. Un
demi-cycle machine vaut exactement deux dots — le PPU ne perd rien.

### D4 — Combien dure l'arrêt, et sur quelle montre — **RETOURNÉE PAR UN ORACLE**

Question qui n'existait pas quand ce cahier a été écrit, et qui saute aux yeux
dès qu'on a deux montres : pandocs dit « 2050 cycles machine (8200 dots) »,
**sans dire lesquels**. À l'aller le processeur bat deux fois plus vite qu'au
retour : la même phrase donne donc deux durées différentes selon le sens.

**Première réponse, et elle était fausse** : la montre du MONDE, au motif qu'un
délai d'oscillateur est un délai physique et dure la même chose en secondes quel
que soit le régime. Jolie idée, aucun oracle derrière — et ce cahier le disait
en toutes lettres, ce qui est au moins ça.

**Réponse arbitrée : la montre du PROCESSEUR, et l'arrêt vaut 32769 cycles, pas
2050.** C'est `spsw-tima` qui a tranché les deux d'un coup (voir le lot 3). Elle
ne bascule que dans un sens, vers le double régime, et le compte d'incréments
qu'elle attend n'est celui d'aucun arrêt facturé au monde.

Conséquence à garder en tête : **une bascule coûte presque une trame d'écran**
(~143 lignes à l'aller). Un jeu qui bascule juste avant une VBlank la rate.

### D2 — Qui possède KEY1 — **proposition : `core/cgb/`**

Le propriétaire posé au lot 7 du jalon CGB. Il déclare déjà SVBK et les
indocumentés ; KEY1 est de la même famille — un registre système, pas du dessin.
La bascule, elle, est demandée par `STOP`, donc par le CPU : il faudra un chemin
`cpu -> machine -> cgb`. Ce chemin n'existe pas encore.

### D3 — Ce que coûte `STOP` — **proposition : 2050 cycles machine** *(RÉFUTÉE)*

Pandocs : le CPU s'arrête 2050 cycles machine (8200 dots) après `STOP`, et **DIV
ne tourne pas** pendant ce temps. C'est une durée, pas un détail de confort :
`spsw-div` et `spsw-tima` mesurent exactement ce que le timer a fait — ou pas —
pendant cet arrêt.

> **Les deux moitiés de cette proposition sont fausses**, et c'est `spsw-tima`
> qui l'a établi : l'arrêt vaut **32769** cycles machine, et le compteur
> **tourne** pendant tout ce temps. Voir D4 et le lot 3. Gardé ici tel quel :
> c'est cette phrase-là qui a orienté tout le lot 3, et savoir d'où venait
> l'erreur vaut mieux que de la faire disparaître.

---

## 5. Les lots

Même boucle qu'au jalon précédent : **concept + analogie -> TU -> code jusqu'au
vert -> on ferme.** Un lot ne s'ouvre qu'une fois le précédent fermé, et aucun n'a
le droit de faire rougir les **1746 tests** existants.

---

### Lot 0 — La base de temps système, sans changer une seconde — **FERMÉ**

**Objectif** : que `machine.systemCycles` existe, que le PPU et l'APU s'en
servent, et que **rien ne bouge** — parce qu'en vitesse simple les deux compteurs
sont le même nombre.

**Le contrat du lot** : la suite complète est verte avant, elle est verte après,
et les deux instantanés acid rendent le même écran à l'octet près. Ce lot ne se
juge pas à ce qu'il ajoute mais à ce qu'il ne casse pas — exactement le lot 0 du
jalon précédent, et pour la même raison : c'est un refactor sous les pieds de
trois chapitres clos.

**Oracle** : la suite elle-même, `dmg-acid2` et `cgb-acid2` en particulier.
**Tenu : 1746 -> 1755 tests, instantanés identiques, blargg et mooneye inchangés.**

Ce que le lot a appris : **vingt-quatre bancs d'essai à porter**. Leurs fausses
machines n'exposaient que `totalCycles`, et l'APU comme le PPU lisaient soudain
`undefined` — 229 tests rouges d'un coup, tous pour la même raison. Le contrat
d'une machine a changé, les doublures doivent le suivre :
`get systemCycles() { return this.totalCycles; }`, ce qui EST la vérité en
vitesse simple.

---

### Lot 1 — KEY1 et STOP : la bascule se déclare — **FERMÉ**

**Objectif** : le registre existe et se relit juste, `STOP` fait la bascule, et
`systemCycles` se met à compter par demis quand elle est enclenchée.

**Ce que le lot doit contenir, et pourquoi il n'est pas coupable en deux** :
mapper KEY1 sans faire la bascule serait pire que de ne rien faire. Aujourd'hui
`$FF4D` se lit 0xFF, donc bit 7 à 1, donc « déjà en double vitesse » : les jeux
n'insistent pas. Le mapper à 0x7E leur dirait « tu es en simple, demande la
bascule » — et sans bascule, ils attendraient pour toujours.

**Attendu, à noter d'avance** : `unused_hwio-C` s'arrête aujourd'hui sur `$FF69`
et un test l'assure. Il s'arrêtera désormais sur **`$FF4D`**, qui vient plus tôt
dans sa table. Ce n'est pas une régression : c'est encore le mode de
compatibilité DMG (voir P3 du cahier CGB), qui verrouille KEY1 comme il verrouille
les autres. Le test doit être porté, pas contourné.

**Oracle** : `spsw-stop-prefetch-cgbBCE.gb`. **Il reste rouge**, comme les sept
autres — et c'est ce qu'on attendait : ce lot fait exister la bascule, il ne
prétend pas la rendre juste à la microseconde.

**Ce qu'on a mesuré à la place, et qui vaut mieux qu'un vert** : la bascule a
lieu, entre 4 et 168 fois selon la ROM. C'est la preuve que le chemin
`KEY1 -> STOP -> machine` est complet ; ce que les ROMs reprochent maintenant est
en aval, dans les lots 2 à 5.

**Correction de lecture au passage** : `PC=0x12D0` n'était pas un `STOP` qui
bloque, contrairement à ce que ce cahier a d'abord écrit. C'est `EI / HALT / JR`,
la boucle de parking que ces ROMs exécutent APRÈS avoir rendu leur verdict. Elles
allaient au bout depuis le début ; elles échouaient, simplement.

**L'attendu s'est réalisé** : `unused_hwio-C` s'arrête désormais sur `$FF4D` au
lieu de `$FF69`. Le test a été porté, pas contourné, et son message explique
maintenant les DEUX façons dont il peut bouger.

---

### Lot 3 — Le timer double vraiment — **FERMÉ**, puis **CORRIGÉ**

**Objectif** : DIV et TIMA suivent la montre du CPU, donc battent deux fois plus
vite dans le monde réel — et quelque chose de particulier arrive pendant l'arrêt
de `STOP`.

**Oracles** : `spsw-div-cgbBCE.gb` **VERT**, et `spsw-stop-prefetch-cgbBCE.gb`
**VERT** aussi, gagnée par la correction ci-dessous alors qu'elle appartenait au
lot 1.

#### Ce que le lot a d'abord conclu — et qui était faux

Pandocs, §FF04 : *« this register is reset when executing the `stop`
instruction, and only begins ticking again once stop mode ends. »* Deux gestes,
la remise à zéro ET le gel. Le lot a implémenté les deux, plus une PHASE mesurée
sur `spsw-div` (le compteur repart un cycle machine avant le processeur), et
`spsw-div` est passée au vert. Trois valeurs de TIMA sur quatre concordaient
aussi. Tout allait bien.

Sauf une ligne : `spsw-tima` attend **TIMA = $80 au réglage 4 kHz**, là où le
modèle gelé rend $00. Et elle attend le drapeau d'interruption du timer levé sur
trois cadences, sans qu'aucun débordement soit possible en 2050 cycles.

#### Ce que la table dit quand on la résout au lieu de la lire

Nos quatre valeurs avec le compteur gelé (`$00 $04 $01 $00`) sont exactement ce
que produit le code AUTOUR du `STOP`. L'écart avec l'attendu donne donc, cadence
par cadence, ce que l'arrêt lui-même a ajouté — quatre équations, plus quatre
contraintes sur le drapeau d'interruption :

```
4 kHz   (1024 T)   0 + delta = 128 mod 256   AUCUN débordement
262 kHz   (16 T)   4 + delta =   4 mod 256   au moins un débordement
65 kHz    (64 T)   1 + delta =   1 mod 256   au moins un débordement
16 kHz   (256 T)   0 + delta =   0 mod 256   au moins un débordement
```

**Huit contraintes, une seule solution : l'arrêt vaut 131072 T-cycles**, soit
32768 cycles machine — et le compteur **tourne** pendant tout ce temps. Pas 2050,
et pas de gel. Vérifié : les quatre valeurs de TIMA et les quatre drapeaux
tombent alors exactement.

#### Pourquoi le modèle faux tenait si bien

**131072 T-cycles, c'est EXACTEMENT 512 crans de DIV.** Un compteur qui tourne
pendant un tel arrêt revient donc sur la même valeur qu'avant : il est
rigoureusement indiscernable d'un compteur gelé, tant qu'on ne regarde que DIV.
C'est pour ça que `spsw-div` passait — et c'est probablement pour ça que la doc
dit « DIV does not tick ». Qui mesure DIV de part et d'autre observe qu'il n'a
pas bougé, et en conclut le gel.

Ce qui tranche est TIMA à 4 kHz, et lui seul : sa période de 1024 T donne 128
incréments sur l'arrêt, et **128 n'est pas un multiple de 256**. Les trois autres
cadences tombent sur des multiples de 256 et rendent la même chose dans les deux
modèles. Une seule des huit lignes du tableau pouvait dire la vérité.

#### Ce que la correction a coûté et rapporté

- `spsw-stop-prefetch` **est passée au vert** : elle mesure elle aussi ce que
  `STOP` avale, et la durée juste la satisfait. Deuxième ROM à corroborer.
- La PHASE mesurée reste vraie, mais elle a déménagé : le `-1` sur `_innerCycles`
  est devenu le `+1` de `STOP_PAUSE = 32769`.
- **Le harnais des ROMs est passé de 60 à 300 trames.** Une bascule coûte
  désormais presque une trame d'écran, et `spsw-div` en enchaîne assez pour ne
  plus finir dans 60. Elle est apparue ROUGE pendant l'expérience pour cette
  seule raison — un faux négatif, le genre qui envoie chercher un bug ailleurs.
- Six tests unitaires ont été PORTÉS, aucun supprimé : ceux qui assuraient le
  gel assurent maintenant qu'il n'y a pas de gel.

#### `spsw-tima` reste ROUGE — mais on sait exactement où, et à combien près

Son `TEST_DS_IF` est juste aux huit octets près. Son `TEST_INC_EDGE`, rejoué
sonde par sonde dans un banc à nous : **24 sur 26**.

Les deux qui manquent sont UNE frontière, au réglage 4 kHz : la ROM place le cran
supplémentaire entre `d1 = 110` et `d1 = 111`, nous entre 109 et 110. **Un cycle
machine.**

Et cette sonde-là ne mesure pas la même chose que les autres, ce qui est tout
l'intérêt. À 4 kHz la période fait 256 cycles machine : bouger `d1` d'un cran ne
peut PAS changer le comptage. Ce que la sonde attrape est donc le **front
descendant** de la remise à zéro de DIV — le §An Edge Case du chapitre timer,
qui pousse TIMA quand le bit surveillé était haut. Les trois autres cadences, au
contraire, franchissent une frontière de période : elles mesurent le comptage,
et le comptage est juste chez nous.

**Deux explications ont été essayées et écartées, et leur échec est informatif :**

| tentative | résultat |
|---|---|
| `STOP` ne paie qu'une lecture (`cpu.pay(-1)`), l'hypothèse évidente | 4 kHz réparé, **262/65/16 kHz cassés** — 20/26 |
| le front jugé un cycle machine avant la remise à zéro | 16/26, le décalage déteint sur le comptage |

Les deux mécanismes veulent des décalages **opposés** : aucun décalage global ne
peut satisfaire les deux à la fois. Ce qui sépare le front du comptage sur du
vrai matériel, je ne le sais pas — et on ne pose donc pas de règle par cadence
pour forcer le vert, ce serait figer une coïncidence plutôt qu'une explication.

*(Le rejeu n'est pas déposé comme test : sa table d'attendus est transcrite à la
main depuis la source de la ROM, et une transcription fautive vaudrait moins que
l'oracle lui-même. Il se refait en quinze lignes à partir de ce qui est décrit
ici.)*

---

### Lot 2 — Le PPU garde son heure — **FERMÉ**

**Objectif** : en vitesse double, le PPU avance deux fois moins vite par cycle
CPU — c'est-à-dire à la même vitesse qu'avant dans le monde réel.

En principe le lot 0 l'a déjà fait. Ce lot-là est celui qui le PROUVE — **et pas
au niveau du getter**, où la preuve ne vaut rien (elle relit ce que le code vient
d'écrire), mais au niveau de l'ÉCRAN : combien de cycles processeur pour une
ligne. 114 en simple, **228 en double**, et 114 de nouveau après la bascule
retour. Le nombre qui double est celui du processeur : c'est la seule façon
honnête de dire que l'écran, lui, n'a pas bougé.

**La vraie décision du lot est D4** (§4), et elle a été RETOURNÉE depuis par
`spsw-tima` : l'arrêt de `STOP` se compte sur la montre du PROCESSEUR, pas sur
celle du monde. Les tests du lot ont été portés en conséquence.

**Et le PPU n'est pas suspendu par `STOP`** — c'est le PROCESSEUR qui l'est. Ça
ne se voyait guère avec un arrêt de 2050 cycles ; avec les 32769 réels, l'écran
avance de **143 lignes** pendant une bascule, soit presque une trame entière. Un
jeu qui bascule juste avant une VBlank la rate pour de bon.

**Oracle** : `spsw-mode0-cgbBCE.gb`, **toujours rouge**, et il faut dire
pourquoi : ce n'est pas un test de cadence mais d'ALIGNEMENT — il lit LY deux
fois de suite et STAT à des délais choisis, de part et d'autre de cinq bascules,
pour vérifier que l'alignement LCD/CPU change quand on double et redouble. C'est
le mur du dot du chapitre PPU, à franchir une seconde fois et à travers une
bascule. Hors de portée de ce lot ; ce que le lot promettait — que l'écran garde
sa cadence — est tenu et tenu par des tests.

---

### Lot 4 — L'APU, qui regarde les deux montres — **FERMÉ**

**Objectif** : les fréquences des voies restent celles du monde (le lot 0 s'en
charge), et le séquenceur de trames reste à 512 Hz — bit 4 de DIV en simple,
**bit 5** en double, ce qui chez nous s'écrit « la période double ».

**Le lot le plus risqué du jalon** : l'APU est un chapitre CLOS, qualifié par
blargg 12/12 et à l'oreille. **`dmg_sound` est resté 12/12.**

**LE BUG QUE CE LOT A TROUVÉ, et il était bien réel.** L'APU demandait au timer
`innerCyclesAt(date du monde)` — une date du MONDE lue contre une origine posée
sur la montre du PROCESSEUR. Tant qu'il n'y a qu'une horloge les deux nombres
sont identiques et personne ne voit rien. Mesuré à la première bascule : le
séquenceur **RECULE de quatre pas**. Quatre pas rejoués, c'est quatre coups de
compteur de longueur, d'enveloppe et de balayage — muet en test, très audible
dans un jeu.

Le correctif ne double pas la période comme ce cahier l'annonçait : il donne au
timer **une seconde origine, notée sur la montre du monde**
(`innerSystemCyclesAt`). Les deux origines bougent ENSEMBLE à chaque remise à
zéro de DIV — c'est ce couplage-là que blargg arbitre depuis toujours — et le
séquenceur compte sa période de 8192 sur celle qui ne s'accélère pas. Le
résultat est le même que le bit 5 du matériel, par un chemin qui ne demande pas
au reste de l'APU de savoir qu'il existe deux régimes.

*(La suite du lot 3 a retiré le gel : le compteur tourne pendant l'arrêt, donc le
séquenceur aussi — huit périodes à l'aller. La phrase de pandocs « DIV does not
tick, so some audio events are not processed » tombe avec le reste, et pour la
même raison : huit est un multiple de huit, donc le séquenceur ressort sur le
même pas de son cycle. Indiscernable d'un gel, une fois de plus.)*

**Une seconde lecture de la même famille, trouvée en tirant le fil** : PCM12 /
PCM34 (`$FF76-77`) passaient `machine.totalCycles` à `amplitude(cycle)`, qui
attend une date du monde. En double régime, c'est demander à une voie ce qu'elle
vaudra deux fois plus loin dans le futur.

**Oracle** : `spsw-ch2-lc-delay-cgbBCE.gb`, **toujours rouge** — il mesure le
délai exact du compteur de longueur de la voie 2 en travers d'une bascule, à
l'échelle du cycle. Le filet `dmg_sound` 12/12, lui, a tenu, et c'était la
condition du lot.

---

### Lot 5 — Les interruptions pendant l'arrêt — **FERMÉ**

**Objectif** : ce qui se passe quand une IRQ tombe pendant l'arrêt.

**La réponse tient en une phrase, et le dépôt AGE la donne** : l'arrêt est un
`halt` déguisé, et il se réveille comme un `halt` — dès qu'une source ARMÉE lève
son drapeau. **La bascule, elle, a bien lieu** : ce n'est pas elle qu'on
interrompt, c'est l'attente qui la suit. Un émulateur qui sortirait de `onStop`
en voyant le drapeau laisserait le jeu en vitesse simple alors qu'il se croit en
double.

La condition est `IE & IF & 0x1F` — celle du RÉVEIL, pas celle du SERVICE, qui
demande en plus `ime` et reste l'affaire de `dispatch()`. Le masque n'est pas
décoratif : IF se lit avec ses trois bits du haut à 1, et les prendre pour des
sources en attente couperait TOUS les arrêts, ce qui viderait le lot 3 de son
contenu.

**L'avertissement du dépôt, et il mérite d'être répété** : son auteur a rendu une
vraie CGB E instable en enchaînant ces deux ROMs, au point qu'un reset n'y
suffisait plus — l'oscillateur n'avait plus le temps de se stabiliser. Le manuel
Nintendo déconseille explicitement la manœuvre. On émule le comportement, pas le
vice.

**Oracles** : `spsw-interrupts-cgbBC.gb` et `-cgbE.gb`, **toujours rouges**. Ils
mesurent, dans le gestionnaire d'interruption, DIV et TIMA à des délais choisis —
donc la phase exacte d'un arrêt écourté, une précision que rien ne nous donne.

---

### Lot F — Le front — **FERMÉ**

**Fait** :

- **le régime dans l'overlay**, à côté du modèle. Il n'apparaît QUE doublé :
  « 1x » affiché en permanence serait du bruit, « 2x » est l'information. Il
  voyage par le battement de métriques déjà en place (5 fois par seconde) et le
  main ne re-rend que s'il a BOUGÉ — un `setState` cinq fois par seconde
  re-rendrait la page entière, ce que tout le dessin de l'overlay évite ;
- **le son rééchantillonné sur l'heure du monde**, et ce point n'était pas au
  programme. `AudioSampler` convertit des cycles machine en 44 100 Hz avec une
  CONSTANTE, et on lui passait `totalCycles`. En double régime il aurait produit
  deux fois trop d'échantillons — un la à 880 Hz, et un tampon qui déborde. Le
  lot F de ce jalon-ci n'est donc pas cosmétique, contrairement à celui du
  précédent.

Corrigé aux deux endroits : le worker et le repli main-thread.

---

## 6. Explicitement hors portée

**Le mode de compatibilité DMG (KEY0, 0xFF4C).** Toujours dehors, pour les mêmes
raisons qu'au jalon précédent (P3 de son cahier). Ce jalon le CROISE — KEY1 est
l'un des registres que ce mode verrouille — mais ne l'ouvre pas.

**Le `STOP` en mode veille** (celui qui attend un appui sur la manette, sans
bascule armée). Aucune ROM sous licence ne l'utilise hors bascule de vitesse, et
pandocs y consacre un diagramme entier de cas tordus. On implémente la bascule ;
la veille reste ce qu'elle est.

---

## 7. Où on en est

**Tous les lots sont fermés. 1801 tests verts, et SIX ROUGES** — les six
oracles AGE que le jalon n'a pas satisfaits. Le filet du §3, lui, a tenu de bout
en bout : blargg `cpu_instrs` 11/11, blargg `dmg_sound` 12/12 et mooneye PPU
12/12 inchangés.

**La suite est rouge, et c'est voulu.** `age-speed-switch.test.js` a d'abord été
écrit en « tableau de bord » : chaque ligne portait son résultat ATTENDU, et
l'assertion comparait `passe === attendu`, si bien qu'une ROM rouge donnait un
test vert. L'intention était de mesurer l'avancement sans faire rougir la suite ;
le résultat était sept verts décrochés sur des oracles qui échouent, ce que ce
dépôt refuse partout ailleurs. Le mécanisme est supprimé : une ROM qui échoue
donne un test rouge, et le message dit ce qu'elle mesure et où elle s'arrête.

| lot | état | son oracle |
|---|---|---|
| 0 — base de temps système | **FERMÉ** | la suite entière |
| 1 — KEY1 et STOP | **FERMÉ** | **`spsw-stop-prefetch` VERT** (gagnée au lot 3) |
| 3 — le timer double vraiment | **FERMÉ**, puis corrigé | **`spsw-div` et `spsw-stop-prefetch` VERTS** |
| 2 — le PPU garde son heure | **FERMÉ** | TU (114 → 228 cycles la ligne) |
| 4 — l'APU et ses deux montres | **FERMÉ** | `dmg_sound` 12/12 tenu |
| 5 — les IRQ pendant l'arrêt | **FERMÉ** | TU (réveil, bascule maintenue) |
| F — le régime et le son | **FERMÉ** | `regime-front.test.jsx` |

### Les oracles, un par un — et six sont encore rouges

| ROM | état | ce qui l'en sépare |
|---|---|---|
| `spsw-div-cgbBCE` | **VERT** | — |
| `spsw-stop-prefetch-cgbBCE` | **VERT** | — (gagnée en corrigeant la durée de l'arrêt) |
| `spsw-tima-cgbBC`, `-cgbE` | rouge | son `TEST_DS_IF` est juste aux 8 octets près ; son `TEST_INC_EDGE` place la bascule au cycle près autour d'un front |
| `spsw-mode0-cgbBCE` | rouge | alignement LY/STAT au dot près, à travers cinq bascules |
| `spsw-ch2-lc-delay-cgbBCE` | rouge | le délai du compteur de longueur au cycle près |
| `spsw-interrupts-cgbBC`, `-cgbE` | rouge | la phase exacte d'un arrêt écourté |

**Ce que ces sept rouges disent, et ce qu'ils ne disent pas.** Ils ne disent pas
que la double vitesse ne marche pas : elle marche, et trois choses le prouvent
autrement — la ligne d'écran passe bien de 114 à 228 cycles processeur, le
séquenceur audio garde ses 512 Hz au lieu de reculer de quatre pas, et deux ROMs
tombent au cycle près. Ils disent que **les six restants mesurent des phases**, pas
des cadences : où tombe exactement un front par rapport à une instruction, à
travers une bascule. C'est le même mur que le dot du chapitre PPU, et il se
franchit avec le même budget — un chapitre, pas un lot.

**La leçon du jalon, la seconde.** Trois fois sur ce jalon, un modèle faux a
tenu parce qu'une COÏNCIDENCE ARITHMÉTIQUE le rendait indiscernable du vrai :
l'arrêt vaut 512 crans de DIV pile, donc DIV semble gelé ; il vaut seize périodes
de séquenceur, donc l'audio semble gelé aussi ; et il vaut huit périodes vu du
monde, ce qui retombe sur le même pas du cycle de huit. Chaque fois, une seule
mesure sur des dizaines pouvait dire la vérité — TIMA à 4 kHz, parce que 128
n'est pas un multiple de 256. **Quand tout concorde sauf une ligne, c'est la
ligne qui a raison.**

**La leçon du jalon, la première.** Deux bugs de ce jalon étaient le MÊME bug, et
aucun test existant ne pouvait les voir : une date lue sur une montre, comparée à
une origine posée sur l'autre. Le séquenceur de l'APU reculait de quatre pas, PCM12
demandait le futur, et le rééchantillonneur audio aurait doublé la hauteur du
son. Tant qu'il n'y a qu'une horloge, ces trois lignes sont indistinguables de
lignes justes. **Dédoubler le temps ne casse rien : ça RÉVÈLE** ce qui n'avait
jamais eu besoin d'être juste.

### Si le jalon rouvre

**Ce qui reste, c'est le tableau ci-dessus en entier : SEPT ROMs.** La liste
ci-dessous n'en est pas le résumé, c'est un ORDRE D'ATTAQUE — les points où je
saurais par où commencer. Les quatre ROMs qui n'y figurent pas ne sont pas
oubliées : je n'ai simplement aucun levier connu à leur proposer, et le dire vaut
mieux que de les ranger dans une liste qui laisserait croire le contraire.

1. **`spsw-tima`**, et le but est à UN CYCLE MACHINE : 24 sondes sur 26, et les
   deux qui manquent sont la même frontière à 4 kHz (voir le lot 3). Ce qui
   bloque est nommé — le front descendant de la remise à zéro de DIV et le
   comptage veulent des décalages opposés — et deux explications sont déjà
   écartées. Choisir laquelle des deux révisions on vise reste la décision
   d'ouverture : l'écart entre elles, `OFS`, ne joue que sur les sondes 65 et
   16 kHz, qui passent déjà toutes les deux en révision B/C.
2. `spsw-mode0` et `spsw-ch2-lc-delay`, qui valent un chapitre à eux deux : ce
   sont les mêmes phases, côté écran et côté son.
3. `spsw-interrupts`, en dernier et sans regret (voir le lot 5).

Et une chose à ne PAS refaire : rendre la suite verte en écrivant l'échec dans
un tableau d'attendus. C'est ce qui a été fait à l'ouverture, et ça a masqué sept
rouges pendant tout le jalon.
