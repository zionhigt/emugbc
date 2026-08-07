# L'APU — les lots jusqu'à la porte blargg

État au 7 août 2026, commit `[IMPL] PUSH AF + purge de NR10` : **7 ROMs vertes sur 12**,
1054 tests unitaires verts.

La porte du chapitre est fixée : les douze ROMs `dmg_sound` vertes. Il n'existe pas d'autre
oracle — mooneye n'a aucune suite son. Cinq restent.

Ce document ne décrit pas l'APU. Il dit **ce qui reste, ce qui est déjà prouvé, et ce qui
coûterait cher à retrouver** en revenant sur le chapitre après une pause.

---

## L'état de l'oracle

| ROM | verdict | ce que blargg nomme | lot |
|---|---|---|---|
| 01-registers | **passe** | — | — |
| 02-len ctr | **passe** | — | — |
| 03-trigger | #8 | Trigger that un-freezes enabled length should clock it | C |
| 04-sweep | **passe** | — | — |
| 05-sweep details | #4 | Exiting negate mode after calculation disables channel | B |
| 06-overflow on trigger | **passe** | — | — |
| 07-len sweep period sync | **passe** | — | — |
| 08-len ctr during power | **passe** | — | — |
| 09-wave read while on | #1 | 70 lectures, 70 fois `77` | A |
| 10-wave trigger while on | #1 | wave RAM intacte : rien n'est modélisé | A |
| 11-regs after power | **passe** | — | — |
| 12-wave write while on | #1 | même famille que 09 | A |

---

## Lot A — la wave pendant qu'elle joue

**ROMs** : 09, 12, puis 10.

### 09 et 12 — la fenêtre d'accès

La ROM déverse soixante-dix octets, **soixante-dix fois `77`** : la fenêtre est bloquée
**ouverte**, et toujours sur le même octet. (Avant la correction de `PUSH AF` elle rendait
`FF` : le temps CPU corrigé a déplacé la lecture pile sur l'instant d'accès. Le symptôme
d'une ROM dépend de l'état du reste de l'émulateur — le relever à nouveau après chaque
correction.)

Le modèle est faux sur trois points, établis par balayage — 170 combinaisons essayées sur
`09`, une seule passe, et `12` qui a une autre CRC tombe sur la même :

1. **L'horloge de la wave doit être en demi-cycles machine** (2 T-cycles, un échantillon à
   la période minimale). La ROM mesure une distinction de 2 T, structurellement invisible
   sur une grille en cycles entiers : c'est la parité de la période au trigger qui décide
   si la lecture du CPU tombe sur l'accès ou à côté.
2. **Une échéance, pas un réancrage.** `captureWaveStep` réancre la position sur la date de
   l'écriture, ce qui efface la période au trigger — or c'est exactement la variable que la
   ROM balaye. Le matériel garde la valeur de rechargement du compteur en vol : le premier
   accès reste programmé à `2·trigger + périodeAuTrigger + 3` demi-cycles, et la nouvelle
   période ne s'applique qu'au rechargement suivant.
3. **La fenêtre s'ouvre à chaque échantillon**, pas à chaque octet, et sur un seul
   demi-cycle. Le commentaire de `channel3.js` affirmait l'inverse. Élargir la fenêtre ne
   donne rien : une largeur de 2 échoue sur toutes les combinaisons.

La constante `+3` demi-cycles est **calibrée, pas dérivée** : elle mêle le retard réel du
trigger de la wave et notre convention sur l'instant où une écriture atterrit dans le cycle
machine. Deux ROMs indépendantes s'accordent dessus.

### 10 — la corruption au trigger

Le dump montre la wave RAM parfaitement intacte (`00 11 22 33 …`). Ce n'est pas un bug,
c'est une règle matérielle jamais implémentée : sur DMG, déclencher le canal 3 pendant
qu'il lit corrompt les premiers octets.

À faire après 09 et 12, dont elle réutilise la mécanique : la même notion de « quel octet,
à quel instant » sert aux deux.

### Poids

Trois ROMs, le plus gros lot restant, et le code de la wave est récent.

---

## Lot B — le mode négatif du sweep

**ROM** : 05, à partir de #4.

`05-sweep details` avance sous-test par sous-test, et la suite est une chaîne de règles
autour du **mode soustraction** :

| # | ce que blargg nomme |
|---|---|
| 4 | Exiting negate mode after calculation disables channel |
| 5 | Ending negate after it maybe changed freq disables chan |
| 6 | Ending negate mode any other way doesn't disable channel |
| 7 | Subtract mode uses two's complement |
| 8 | Subtract mode uses two's complement (upper bound) |
| 9 | Update channel frequency only when period is reloaded |

La règle centrale : une fois qu'un calcul a été fait en mode négatif, **quitter ce mode
éteint le canal**. Il faut donc retenir qu'un calcul négatif a eu lieu — un drapeau de
plus dans l'unité de sweep, remis à zéro au trigger.

Le source de blargg est lisible en brut sur `retrio/gb-test-roms`, et il documente chaque
sous-test par un commentaire. À lire avant d'écrire quoi que ce soit.

### Poids

Une ROM, mais six sous-tests enchaînés : c'est un lot de règles, pas un correctif.

---

## Lot C — le cran gratuit au trigger

**ROM** : 03, à #8 — « Trigger that un-freezes enabled length should clock it ».

Dernier survivant de ce qui était le gros lot de la longueur. Les trois autres ROMs de cette
famille sont tombées avec la correction du CPU, ce qui laisse une règle isolée et nommée :
un trigger qui **active la longueur sur la même écriture** doit recharger le compteur au
maximum **puis** le décrémenter aussitôt. On ne l'implémente pas du tout aujourd'hui.

### Poids

Une ROM, une règle. Mais c'est la seule qui ait résisté à toute l'enquête sur la phase du
carillon, donc à traiter avec méthode.

---

## Ordre conseillé

1. **Lot A** — trois ROMs, symptôme net, suspect nommé, code récent.
2. **Lot B** — une chaîne de règles bien documentées par blargg lui-même.
3. **Lot C** — isolé, sans dépendance, donc déplaçable à volonté.

---

## Une règle d'architecture, apprise quatre fois

Dans cet APU, plusieurs unités sont **dérivées** : rien ne tourne en fond, on interroge leur
état à une date. Certaines sont en plus à **état gardé** — elles retiennent une valeur avec
sa date de capture, ou rattrapent leur retard paresseusement quand on les interroge.

> **Toute écriture dans un registre qui gouverne une telle unité doit d'abord la faire
> rattraper son retard, AVANT de changer la valeur.**

Sans ça, ce qui s'est déjà produit est recompté avec un réglage posé après coup. Quatre
applications à ce jour, toutes trouvées séparément avant que la règle soit nommée :

| registre | unité | méthode |
|---|---|---|
| NR33, NR34 | position de wave | `captureWaveStep` |
| NR43 | LFSR du bruit | `captureLfsrStep` |
| NR10 | sweep | `captureSweepStep` |
| NR11, NR21, NR31, NR41 | compteur de longueur | capture dans `NRegister1` / `NRegister4` |

**Candidat non vérifié** : NR12 et ses homologues. `volumeAt` lit `envelopePeriod` et
`isEnvelopeIncreasing` au moment de l'appel (`channel.js`), donc l'enveloppe est
probablement dans le même cas. Aucune ROM ne l'a réclamé pour l'instant.

---

## Acquis à ne pas re-dériver

**L'oracle du son teste aussi le CPU.** `delay_apu` est du code qui s'exécute, pas une
horloge de test. Un seul cycle machine manquant dans `PUSH_AF` — qui ne payait pas le
décrément de SP là où `PUSH_r16` le payait — faisait dériver chaque `delay_apu` de 16
cycles, et coûtait **trois ROMs**. Avant de suspecter l'APU, vérifier que le temps que
blargg croit mesurer est celui qui s'écoule.

**`delay_apu`** vaut **4096 cycles machine**, soit une période de longueur, soit deux tics
de carillon. Établi par les commentaires de `05` #6. Le fichier `apu.s` où vit la macro
n'est publié dans **aucun** miroir de gb-test-roms : seul le comportement le pince.

**Le verdict** — ces douze ROMs n'écrivent rien sur le port série. Tout est en RAM
cartouche : code en `$A000`, signature `DE B0 61` en `$A001-$A003`, texte terminé par un
zéro à partir de `$A004`. C'est la **phrase** qui vaut, pas le numéro : elle nomme la règle
manquante.

**Le traceur** — un pilote autonome lancé par `vite-node`, dont le harnais se copie depuis
`dmg-sound.test.js`, journalise ce qu'on veut et marche **aussi sur une ROM qui passe**, ce
que le journal `APU_JOURNAL` intégré ne permet pas.

**Les cartouches** — aucune des rouges n'attend quoi que ce soit du MBC. Elles déclarent le
type `0x03`, mais avec 32 Ko de ROM et un seul banc de 8 Ko de RAM : rien à commuter.

**Les noms de fichiers mentent.** `04-sweep` #4 s'appelle « If period=0, doesn't calculate »
et pose pace 0 *et* shift 0 : le sweep ne calcule jamais, et ce que la ROM mesure est le
compteur de longueur. Toujours lire le source du sous-test avant de croire son intitulé.

---

## Pistes réfutées, à ne pas rouvrir

**La phase du carillon.** Une matrice de huit variantes a été mesurée — cloche de longueur
inclusive, origine de `powerOn` décalée, phase de `nextStepClocksLength`, sweep et
enveloppe — avec le tableau des douze ROMs à chaque fois. **Aucune ne dépassait 3 vertes.**
Trois choses en sont restées :

- `incl(t−1) == excl(t)` pour n'importe quel jeu de positions. Décaler l'origine annule
  donc le passage à l'inclusif : plusieurs combinaisons « qui marchaient » étaient
  algébriquement le repère. À vérifier avant d'attribuer un gain à un bouton.
- `powerOn` est innocenté par la trace : `lengthRemaining` ne lit que des **différences**,
  donc un décalage constant s'annule entre la capture et la mesure.
- Le saut de `04` #4 à #8 qu'on attribuait à la phase du sweep était en réalité la dérive
  de `delay_apu`. La correction de `PUSH AF` produit le même saut, sans toucher à la phase.

**Le modèle pandocs du rechargement du pace.** Pandocs dit qu'écrire 0 dans la cadence
désactive les itérations instantanément et que la valeur est rechargée dès qu'on repose du
non-nul. `05` #2 contredit ce modèle : c'est celui du wiki gg8 — « treat a period of 0 as
8 », minuteur qui continue de descendre — que la ROM exige, et c'est celui qu'on avait déjà.

---

## L'angle mort de la porte

`dmg_sound` ne teste que ce que **le CPU peut observer** : registres, longueur, trigger,
sweep, accès à la wave RAM.

Rien dans les douze ROMs n'écoute la suite du LFSR, les pochoirs de duty, ni le mixage.
Tout ce qui a été construit récemment passerait la porte **en sonnant faux** — et à
l'inverse, une ROM commerciale peut sonner juste avec plusieurs de ces rouges.

La porte valide la *mécanique* de l'APU, pas son *son*. D'où deux critères plutôt qu'un :
les douze vertes, et une écoute réelle — qui suppose l'échantillonnage et le branchement au
front, lesquels n'existent pas encore.

---

Sources : wiki gbdev (Gameboy sound hardware), pandocs (Audio details, Audio Registers,
FF10), et les sources de blargg dans `retrio/gb-test-roms`. Les verdicts et les dates en
tics viennent de l'exécution des ROMs sur l'émulateur, pas de la documentation.
