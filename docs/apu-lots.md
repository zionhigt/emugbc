# L'APU — les lots jusqu'à la porte blargg

État au 7 août 2026 : **3 ROMs vertes sur 12**, 512 tests unitaires APU verts, dépôt propre.

La porte du chapitre est fixée : les douze ROMs `dmg_sound` vertes. Il n'existe pas d'autre
oracle — mooneye n'a aucune suite son. Neuf restent, et elles se regroupent en quatre lots
de natures très différentes.

Ce document n'explique pas l'APU. Il dit **ce qui reste, ce qui est déjà prouvé, et ce qui
coûterait cher à retrouver** si on revient sur le chapitre après une pause.

---

## L'état de l'oracle

| ROM | verdict | ce que blargg nomme | lot |
|---|---|---|---|
| 01-registers | **passe** | — | — |
| 02-len ctr | #7 | Trigger with disabled length should convert 0 length to maximum | A |
| 03-trigger | #8 | Trigger that un-freezes enabled length should clock it | A |
| 04-sweep | #4 | If period=0, doesn't calculate | B |
| 05-sweep details | #2 | Timer treats period 0 as 8 | B |
| 06-overflow on trigger | **passe** | — | — |
| 07-len sweep period sync | #2 | Length period is wrong | A |
| 08-len ctr during power | **passe** | — *à protéger* | A |
| 09-wave read while on | #1 | 70 lectures, 70 fois `FF` | C |
| 10-wave trigger while on | #1 | wave RAM intacte : rien n'est modélisé | D |
| 11-regs after power | #4 | Powering off shouldn't affect NR41 | A |
| 12-wave write while on | #1 | même famille que 09 | C |

---

## Lot A — la longueur et le carillon

**ROMs** : 02, 03, 07, 11 à gagner, 08 à ne pas perdre.

### Acquis

Huit variantes de phase ont été mesurées, avec le tableau des douze ROMs à chaque fois.
Deux résultats valent d'être gardés :

- **`powerOn` est innocenté**, par la trace et non par déduction. Une voie déclenchée au
  tic 0 se comporte à l'identique sous les deux règles, parce que `lengthRemaining` ne lit
  que des **différences** : le décalage constant s'annule entre la capture et la mesure.
- **`incl(t−1) == excl(t)`** pour n'importe quel jeu de positions. Décaler l'origine du
  carillon annule donc exactement le passage à l'inclusif. Plusieurs combinaisons qui
  « marchaient » se sont révélées algébriquement identiques au repère. À vérifier avant
  d'attribuer un gain à un bouton.

### Le nœud

**08 et 11 sont mutuellement exclusives** sur la totalité de la matrice. La cloche de
longueur inclusive prend 11 et perd 08 ; l'exclusive fait l'inverse. Aucun des trois
boutons de phase ne prend les deux.

Ce n'est donc pas un réglage qui manque, c'est une **règle**.

### À faire

Redériver **ensemble** la phase de la cloche, le cran gratuit (`nextStepClocksLength`) et
la capture. Les trois dérivent de la même horloge et ne se réparent pas séparément — c'est
ce que la matrice a coûté pour l'établir.

### Poids

Le plus gros lot et le plus dur. Quatre ROMs à gagner, une à ne pas perdre, et une
trentaine de tests unitaires écrits sous l'ancienne phase à **porter, pas à supprimer**.

---

## Lot B — le sweep

**ROMs** : 04, 05.

### Acquis

`04-sweep` #4 **n'est pas un test de sweep**. Il pose `NR10 = $00`, donc pace 0 *et*
shift 0 : le sweep ne calcule jamais, et ce que la ROM mesure est le compteur de longueur.
Beaucoup de sous-tests de 04 et 05 sont des tests de longueur déguisés — le nom du fichier
ne dit rien de la règle testée.

Ce sous-test est arbitré par la phase **relative** entre la cloche de sweep et celle de
longueur : blargg s'y synchronise sur le sweep (`sync_sweep`) et mesure la longueur, donc
seul leur écart compte.

### Le nœud

Deux modèles documentés s'opposent sur le même registre :

> **wiki gg8** — The volume envelope and sweep timers treat a period of 0 as 8.

> **pandocs, FF10** — The hardware doesn't re-read this value until a sweep iteration
> completes or the channel is retriggered. However, if `0` is written to this field, then
> iterations are instantly disabled, and it will be reloaded as soon as it's set to
> something else.

`05-sweep details` #2, « Timer treats period 0 as 8 », est exactement le sous-test qui les
départage. C'est son objet.

Pandocs ajoute une règle qu'on n'implémente pas du tout :

> In addition mode, if the period value would overflow, the channel is turned off instead.
> **This occurs even if sweep iterations are disabled by the pace being 0.**

Or notre calcul entier est sous `if (this.sweepPace !== 0)` : avec un pace nul on ne
calcule pas, on ne vérifie pas le débordement, on n'éteint jamais.

Trois gestes sont à distinguer, et les règles ne les gouvernent pas ensemble :
**calculer**, **écrire en retour**, **vérifier le débordement**. `04` #4 s'appelle
« doesn't *calculate* », `04` #12 s'appelle « doesn't *update* ».

### Piège

Décaler la cloche de sweep d'un tic fait passer `04` de #4 à #8 — **dans les deux
directions opposées**. On tient l'effet sans tenir la cause, et ça contredit la table
documentée du frame sequencer (sweep aux positions 2 et 6). À ne pas committer.

### Poids

Deux ROMs. La cause doit être prouvée par une trace **avant** qu'un test soit écrit : une
passe a déjà produit huit tests bien écrits autour de la mauvaise unité.

---

## Lot C — la fenêtre de la wave

**ROMs** : 09, 12.

### Acquis

Le symptôme est sans ambiguïté : la ROM déverse soixante-dix octets, **soixante-dix fois
`FF`**. La fenêtre ne s'ouvre pas une seule fois. Ce n'est pas un décalage à ajuster, c'est
une condition fausse en permanence.

### Suspect

`isAccessingWaveAt` compte encore `(cycle - triggeredAt) % period`, alors que la position
de wave, elle, a été portée sur sa paire capturée (`_lastWaveStep` / `_lastWaveAt`). Dès
que la fréquence change en vol — ce que `09` fait juste après le trigger — l'ancre et la
période ne se rapportent plus au même instant.

### À trancher

La largeur de la fenêtre. Le wiki parle d'« a couple of clocks » en T-cycles ; notre grain
le plus fin est le cycle machine, donc au-dessus. Si blargg réclame plus large, c'est ce
seul chiffre qui bouge.

### Poids

Le lot le moins cher : deux ROMs, un symptôme net, un suspect nommé, et le code de la wave
est récent.

---

## Lot D — la corruption au trigger

**ROM** : 10.

### Acquis

Le dump montre la wave RAM parfaitement intacte (`00 11 22 33 …`). Ce n'est pas un bug,
c'est une règle matérielle jamais implémentée : sur DMG, déclencher le canal 3 pendant
qu'il lit corrompt les premiers octets.

### À faire

Poser la règle. Elle dépend de l'octet que le canal occupait au moment du trigger, donc du
lot C : la même notion de « quel octet, à quel instant » sert aux deux.

### Poids

Une ROM, un cran isolé, à faire après C dont il réutilise la mécanique.

---

## Ordre conseillé

1. **Lot C** — deux ROMs pour un symptôme non ambigu et un suspect déjà nommé. Meilleur
   rapport, et deux vertes de plus changent la lecture de tout le reste.
2. **Lot B** — la documentation vient d'être complétée, autant finir tant que le contexte
   est chaud.
3. **Lot A** — le plus gros, le plus dur, et celui qui demande de porter une trentaine de
   tests. *L'argument inverse se défend* : c'est aussi celui qui débloque le plus de ROMs.
   Mais on y entrerait avec une règle manquante et non identifiée, ce qui est la pire
   condition pour un gros lot.
4. **Lot D** — en dernier, il réemploie ce que C aura construit.

---

## Acquis à ne pas re-dériver

**`delay_apu`** vaut **4096 cycles machine**, soit une période de longueur, soit deux tics
de carillon. Établi par les commentaires de `05` #6. Le fichier `apu.s` où vit la macro
n'est publié dans **aucun** miroir de gb-test-roms : seul le comportement le pince.

**Le verdict** — ces douze ROMs n'écrivent rien sur le port série. Tout est en RAM
cartouche : code en `$A000`, signature `DE B0 61` en `$A001-$A003`, texte terminé par un
zéro à partir de `$A004`. C'est la **phrase** qui vaut, pas le numéro : elle nomme la règle
manquante.

**Le traceur** — un pilote autonome lancé par `vite-node` journalise les transitions
allumé/éteint des quatre voies avec leur date en tics, et il marche **aussi sur une ROM qui
passe**, ce que le journal `APU_JOURNAL` intégré ne permet pas. C'est l'instrument qui a
tranché toutes les questions de phase.

**Les cartouches** — aucune des neuf rouges n'attend quoi que ce soit du MBC. Elles
déclarent le type `0x03`, mais avec 32 Ko de ROM et un seul banc de 8 Ko de RAM : rien à
commuter. Seule l'activation de la RAM sert, et elle marche déjà.

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
