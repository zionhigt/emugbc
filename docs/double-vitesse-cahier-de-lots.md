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
double. Chez nous, c'est une période qui double. Voir le lot 4.

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
| Le séquenceur APU est soudé à DIV bit 4 | lot 4 |

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
de la même façon — `regs=[0,107,20,6,152,16]`, PC figé à `0x12D0`. C'est la
signature d'un `STOP` qui n'a rien fait : la ROM attend une bascule qui n'arrive
jamais. Un point de départ uniforme, ce qui est une bonne nouvelle : le premier
lot qui débloque `STOP` les fera toutes bouger d'un coup, et c'est ensuite que
leurs verdicts divergeront.

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

### D2 — Qui possède KEY1 — **proposition : `core/cgb/`**

Le propriétaire posé au lot 7 du jalon CGB. Il déclare déjà SVBK et les
indocumentés ; KEY1 est de la même famille — un registre système, pas du dessin.
La bascule, elle, est demandée par `STOP`, donc par le CPU : il faudra un chemin
`cpu -> machine -> cgb`. Ce chemin n'existe pas encore.

### D3 — Ce que coûte `STOP` — **proposition : 2050 cycles machine**

Pandocs : le CPU s'arrête 2050 cycles machine (8200 dots) après `STOP`, et **DIV
ne tourne pas** pendant ce temps. C'est une durée, pas un détail de confort :
`spsw-div` et `spsw-tima` mesurent exactement ce que le timer a fait — ou pas —
pendant cet arrêt.

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

### Lot 2 — Le PPU garde son heure

**Objectif** : en vitesse double, le PPU avance deux fois moins vite par cycle
CPU — c'est-à-dire à la même vitesse qu'avant dans le monde réel.

En principe le lot 0 l'a déjà fait. Ce lot-là est celui qui le PROUVE, et qui
traite les surprises : le verrou VRAM/OAM pendant l'arrêt de 2050 cycles, que
pandocs décrit mode par mode (écran noir en mode 0/1, fond sans objets en mode 2,
rien de changé en mode 3).

**Oracle** : `spsw-mode0-cgbBCE.gb`.

---

### Lot 3 — Le timer double vraiment

**Objectif** : DIV et TIMA suivent la montre du CPU, donc battent deux fois plus
vite dans le monde réel — sauf pendant l'arrêt de `STOP`, où DIV ne tourne pas.

**Oracles** : `spsw-div-cgbBCE.gb`, `spsw-tima-cgbBC.gb`, `spsw-tima-cgbE.gb`.
Les deux variantes de `tima` diffèrent par la révision de puce : elles ne peuvent
pas être vertes toutes les deux, et **choisir laquelle on vise est une décision à
prendre au moment d'ouvrir le lot**, pas une fatalité à subir.

---

### Lot 4 — L'APU, qui regarde les deux montres

**Objectif** : les fréquences des voies restent celles du monde (le lot 0 s'en
charge), et le séquenceur de trames reste à 512 Hz — bit 4 de DIV en simple,
**bit 5** en double, ce qui chez nous s'écrit « la période double ».

**Le lot le plus risqué du jalon**, et il faut le dire : l'APU est un chapitre
CLOS, qualifié par blargg 12/12 et à l'oreille. On vient toucher son horloge.
`dmg_sound` reste vert ou le lot ne passe pas.

**Oracle** : `spsw-ch2-lc-delay-cgbBCE.gb`, avec `dmg_sound` en filet.

---

### Lot 5 — Les interruptions pendant l'arrêt

**Objectif** : ce qui se passe quand une IRQ tombe pendant les 2050 cycles.

Deux ROMs, deux révisions de puce, et un avertissement du dépôt (voir §3). Petit
lot, incertain, sans conséquence sur les jeux : à traiter en dernier, et à
abandonner sans remords s'il s'avère être un puits.

---

### Lot F — Le front

**À faire** : afficher le régime dans l'overlay, à côté du modèle. `WK CGB 2x`
dit d'un coup d'œil ce qu'aucun log ne dira.

Ne bloque rien.

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

**Lots 0 et 1 fermés. 1774 tests au vert.**

| lot | état | ce qu'il reste à prouver |
|---|---|---|
| 0 — base de temps système | **FERMÉ** | — |
| 1 — KEY1 et STOP | **FERMÉ** | — |
| 2 — le PPU garde son heure | ouvert | `spsw-mode0` |
| 3 — le timer double vraiment | ouvert | `spsw-div`, `spsw-tima` ×2 |
| 4 — l'APU et ses deux montres | ouvert | `spsw-ch2-lc-delay`, filet `dmg_sound` |
| 5 — les IRQ pendant l'arrêt | ouvert | `spsw-interrupts` ×2 |
| F — le régime dans l'overlay | ouvert | — |

Les huit oracles sont toujours rouges, et le tableau de bord
(`age-speed-switch.test.js`) les tient ligne par ligne. **Ce qui a changé et ne
se voit pas dans ce tableau** : la bascule a désormais lieu pour de bon, et le
temps du monde se dédouble avec elle. Ce qui manque est du détail de cadence —
c'est-à-dire précisément ce que ces huit ROMs savent mesurer et que rien d'autre
ne sait voir.

**Le prochain lot est le 3**, et pas le 2 : DIV qui ne tourne pas pendant les
2050 cycles d'arrêt est la seule pièce dont on connaît déjà la forme exacte
(l'origine du timer se décale, une ligne), et trois des huit ROMs en dépendent.
