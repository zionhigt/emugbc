# L'APU — la porte blargg est franchie

**12 ROMs `dmg_sound` vertes sur 12**, 1569 tests unitaires verts. Parti de 3 vertes.

Ce document ne décrit plus des lots à faire : il garde ce que le chapitre a coûté à
apprendre, et ce que la porte ne dit pas.

---

## Ce qui a réellement bloqué

Huit ROMs ont été gagnées, et une seule des quatre causes était là où on la cherchait.

**Un cycle machine dans le CPU.** `PUSH_AF` ne payait pas son décrément de SP là où
`PUSH_r16` le payait : 3 cycles au lieu de 4. La macro `delay_apu` de blargg contient un
`PUSH AF` dans sa boucle, donc chaque attente dérivait de 16 cycles. **Trois ROMs APU
tenaient à cette ligne.** Avant de suspecter l'unité testée, vérifier que le temps que la
ROM croit mesurer est celui qui s'écoule.

**Quatre unités à état gardé rattrapées avec le registre d'après.** Voir la règle
d'architecture ci-dessous.

**Le modèle temporel de la wave**, passé du cycle machine au demi-cycle : les ROMs 09, 10
et 12 mesurent une distinction de 2 T-cycles, structurellement inexprimable sur une grille
en cycles entiers.

**Deux règles de longueur dont les conditions avaient été alignées à tort.** Le wiki les
distingue littéralement : la cloche gratuite exige « was PREVIOUSLY disabled **and** now
enabled », le rechargement au trigger se contente de « **is now** enabled ». Les aligner par
souci de symétrie est précisément ce qui cassait `03-trigger`.

---

## La règle d'architecture, apprise quatre fois

Plusieurs unités de cet APU sont **dérivées** — rien ne tourne en fond, on interroge leur
état à une date — et certaines sont en plus à **état gardé** : elles retiennent une valeur
avec sa date, ou rattrapent leur retard paresseusement quand on les interroge.

> **Toute écriture dans un registre qui gouverne une telle unité doit d'abord la faire
> rattraper son retard, AVANT de changer la valeur.**

Sans ça, ce qui s'est déjà produit est recompté avec un réglage posé après coup.

| registre | unité | méthode |
|---|---|---|
| NR33, NR34 | position de wave | `catchUpWave` |
| NR43 | LFSR du bruit | `captureLfsrStep` |
| NR10, NR13 | sweep | `captureSweepStep` |
| NR11, NR21, NR31, NR41 | compteur de longueur | capture dans `NRegister1` / `NRegister4` |

Corollaire découvert avec NR13 : l'unité qui **réécrit** un registre depuis l'intérieur de
sa propre boucle doit passer par une porte brute (`write()`) et non par `setValue`, sous
peine de rentrer dans son propre rattrapage. Récursion de profondeur 29 mesurée avant
correction.

**Candidat non vérifié** : NR12 et ses homologues. `volumeAt` lit `envelopePeriod` au moment
de l'appel. Aucune ROM ne l'a réclamé.

---

## Les constantes calibrées

Deux valeurs du canal 3 ne se dérivent d'aucun schéma : elles ont été trouvées par balayage
et confirmées par une seconde ROM au CRC différent. Le code le dit à leur endroit, et il
faut que ça reste dit.

- **`WAVE_TRIGGER_DELAY = 3` demi-cycles** — l'instant du premier accès après un trigger.
  170 combinaisons essayées sur `09`, une seule passante, retrouvée à l'identique sur `12`.
- **`NR34_WRITE_HALF_CYCLE_OFFSET = 1`** — l'écriture de NR34 et la lecture CPU de la wave
  RAM n'atterrissent pas au même T-cycle du cycle machine. 84 combinaisons sur `10`. La
  piste d'une fenêtre plus large est réfutée : aucune largeur ≥ 2 ne passe, à aucune phase.

---

## Ce qui reste ouvert, et qu'aucune ROM n'arbitre

- **Le désarmement du drapeau de soustraction** se lit comme un front ou comme un état.
  Aucune séquence atteignable ne les sépare, le drapeau ne s'armant qu'avec le bit levé.
  Le front a été retenu sur la formulation de la doc (« **Clearing** the sweep direction
  bit »).
- **La variante CGB-02** du cran gratuit (« the length counter only has to have been
  disabled before ») casse Prehistorik Man et a été corrigée en CGB-04/05. Hors périmètre :
  on émule une DMG. Noté pour qu'on n'y voie pas un oubli.
- **Un trigger jette les coups de sweep en retard** au lieu de les jouer (`onTrigger` fait
  `_sweptTicks = sweepTicks(now)`). Aucune ROM ne le prend en défaut — angle mort, pas
  régression.
- **`frequencyAt` renvoie `undefined`** sur sa branche « date antérieure ». Inerte
  aujourd'hui, puisque aucun appelant ne lit ce retour. Mine si quelqu'un s'y fie.

---

## Trois pièges de méthode, chèrement payés

**Les noms de fichiers mentent.** `04-sweep` #4 s'appelle « If period=0, doesn't calculate »,
pose pace 0 *et* shift 0 — donc le sweep ne calcule jamais — et mesure en réalité le
compteur de longueur. Toujours lire le source du sous-test avant de croire son intitulé.

**Un test vert au commentaire faux est pire qu'un test rouge.** Un test de longueur
justifiait son attente en invoquant `02-len ctr` #6. Sonde posée dans la branche : elle
n'est empruntée que par `03-trigger`, jamais par `02-len ctr` sur ses 352 écritures de NRx4,
et le site cité était à une étape paire — le résultat observé venait de la phase, pas de la
condition qu'on lui attribuait. Ce commentaire a servi de garde-fou contre la bonne
correction pendant tout un chapitre.

**La doc d'abord, la mesure ensuite.** Une règle a été établie par la trace seule alors que
deux paragraphes la donnaient, au prix d'un aller-retour complet. Et la mesure ne dit jamais
rien des variantes qu'on ne teste pas — la CGB-02 ci-dessus n'était visible que dans le
texte. Pandocs répond 403 sur `gbdev.io` : lire les sources du dépôt `gbdev/pandocs` en brut.

**Une piste entière réfutée** : la phase du carillon, huit variantes mesurées avec le tableau
des douze ROMs à chaque fois, aucune au-dessus de 3 vertes. Son gain apparent venait en
réalité du bug de `PUSH AF`. Deux identités à retenir : `incl(t−1) == excl(t)` pour
n'importe quel jeu de positions, donc décaler l'origine annule le passage à l'inclusif ; et
`lengthRemaining` ne lit que des **différences**, donc un décalage constant est invisible.

---

## Les instruments

- **Le verdict** est en RAM cartouche, pas sur le port série : code en `$A000`, signature
  `DE B0 61`, texte terminé par un zéro à partir de `$A004`. C'est la **phrase** qui vaut,
  pas le numéro.
- **`APU_JOURNAL=60 npx vitest run … -t "05-sweep details.gb"`** journalise les derniers
  accès APU avec leur date en tics de carillon.
- **Un traceur autonome** lancé par `npx vite-node`, harnais copié depuis
  `dmg-sound.test.js`, journalise ce qu'on veut et marche **aussi sur une ROM qui passe** —
  ce que le journal intégré ne permet pas. C'est l'instrument qui a tranché toutes les
  questions de phase.
- **`delay_apu 1` = 4096 cycles machine** = une période de longueur = 2 tics de carillon.
  Le fichier `apu.s` où vit la macro n'est publié dans aucun miroir.
- **Le balayage de paramètres** — rejouer une ROM entière sur chaque combinaison — a résolu
  ce que le raisonnement n'atteignait pas. Toujours rapporter la matrice, pas la gagnante :
  c'est en voyant que *deux directions opposées* passaient qu'on a su tenir l'effet sans la
  cause.

---

## L'angle mort de la porte

`dmg_sound` ne teste que ce que **le CPU peut observer** : registres, longueur, trigger,
sweep, accès à la wave RAM.

Rien dans les douze ROMs n'écoute la suite du LFSR, les pochoirs de duty, ni le mixage.
L'APU peut donc être vert de bout en bout **et sonner faux**. La porte valide la *mécanique*,
pas le *son*.

Ce qui manque pour entendre quoi que ce soit : quelqu'un qui appelle `apu.sample(cycle)` à
cadence régulière et remplit un tampon. Le rendu est déjà déporté dans un Worker — la
première question sera donc de savoir qui échantillonne, du Worker ou du thread principal.
