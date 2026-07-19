# Le coût en cycles du SM83, mappé sur emugbc

Document de travail pour l'étape « consommation réelle du CPU ». Source des chiffres :
*Game Boy: Complete Technical Reference* (gekkio, rev. 188), chapitres 5 et 6.

Tous les coûts sont en **cycles machine (M-cycles)**, l'unité de la colonne `Duration`
de gbctr et celle de ta config `buildInstruction(id, cycle, bytes, run)`.

---

## 1. Comment lire une fiche gbctr

Chaque instruction a deux tableaux.

**Simple timing** — une bande `M-cycle` et une bande `Mem R/W`. C'est celui qui te sert :
il dit quel M-cycle fait quel accès. Trois valeurs possibles par case :

| Case | Sens |
|---|---|
| `opcode` / `CB prefix` | lecture de l'octet d'instruction à `PC` |
| `R: n`, `R: lsb nn`, `R: e` | lecture d'un octet d'**opérande** à `PC` |
| `R: data` / `W: data` | accès aux **données** (adresse `HL`, `SP`, `WZ`, `0xFF00+n`...) |
| *(case vide)* | **cycle interne** : aucun accès au bus |

**La règle qui résume tout : un M-cycle sans rien dans `Mem R/W` est un cycle interne.**

**Detailed timing** — le même découpage, mais ligne par unité fonctionnelle
(`Addr bus`, `Data bus`, `IDU op`, `ALU op`, `Misc op`). Nécessaire seulement pour savoir
*ce que* fait un cycle interne, pas pour le facturer. Deux clés de lecture :

- `W` et `Z` sont une paire 16 bits **interne et invisible** qui sert de brouillon aux
  opérandes. `nn` s'assemble dans `Z` puis `W`, et l'accès final adresse `WZ`.
- L'`IDU` est une unité d'incrément 16 bits **séparée de l'ALU**. Elle travaille en
  parallèle du transfert sur le bus de données : c'est pour ça que `PC = PC + 1` ne coûte
  jamais de cycle en propre.

**Le piège de la dernière colonne.** Les fiches montrent une colonne de plus que la durée
annoncée, notée `M5/M1` (ou `M3/M1`, etc.). Elle **n'appartient pas** à l'instruction :
c'est le fetch de la suivante, montré pour situer la jointure. C'est le *fetch/execute
overlap* (gbctr §5.1) : le fetch d'un opcode est physiquement le dernier cycle de
l'instruction précédente. Les `Previous` de la colonne M1 disent la même chose dans
l'autre sens.

Conséquence pratique : **ta convention de durée est déjà la bonne**, celle du champ
`Duration`. Ne compte pas la colonne `Mn/M1`.

---

## 2. Les primitives de coût

Il n'y en a que trois.

| Primitive | Coût | Origine |
|---|---|---|
| **Fetch** (opcode, préfixe CB, octet d'opérande) | 1 chacun | lecture à `PC` |
| **Accès aux données** (lecture ou écriture) | 1 chacun | accès au bus à une adresse autre que `PC` |
| **Cycle interne** | 1 chacun | ALU 16 bits, rechargement de `PC`, décision `cc` |

> **« Registre » désigne deux choses opposées ici.** Les registres du **CPU** (`A`, `B`,
> `HL`, `SP`…) vivent dans le *register file*, à l'intérieur du cœur : aucun bus,
> **0 cycle** — d'où `LD B,C` = 1, son seul fetch. Les registres **matériels**
> (`DIV`, `TIMA`, `LY`, `LCDC`, `IE`…) sont *memory-mapped* : ils ont une adresse et
> s'atteignent par le bus comme n'importe quel octet de WRAM, donc **1 cycle**. RAM, VRAM,
> ROM, OAM et le bloc `0xFFxx` se facturent tous pareil.
>
> Chez toi la frontière est déjà structurelle : ce qui passe par `cpu.registers` est
> gratuit, ce qui passe par `cpu.memory` coûte 1.

D'où la formule générale :

```
coût = 1 (opcode)
     + 1 si préfixe CB
     + nombre d'octets d'opérande
     + nombre d'accès aux données
     + cycles internes
```

Vérification sur trois cas :

- `LD B,C` : 1 + 0 + 0 + 0 + 0 = **1**
- `LD BC,nn` : 1 + 0 + 2 + 0 + 0 = **3**
- `RLC (HL)` (CB 0x06) : 1 + 1 + 0 + 2 + 0 = **4**

---

## 3. Cartographie sur ton architecture

L'audit du code montre que **tout le trafic mémoire du CPU traverse une seule propriété**,
`cpu.memory` :

- 51 accès dans `instructions.js`, 51 via `cpu.memory.` — zéro exception
- `Stack` reçoit `this.memory` à la construction (`CPU.js`)
- `decoder.fetch()` passe par le getter `this.cpu.memory` (`decodeur/index.js`)

Et `cpu.memory` est assignée en un seul endroit : `initMemory()`.

### Ce qui se facture tout seul

| Primitive | Point de facturation | Couverture |
|---|---|---|
| Fetch opcode | `decoder.fetch()` | 100 % des instructions |
| Préfixe CB | `decoder.fetch()` | les 256 CB |
| Octets d'opérande | `decoder.fetch()` | `n8`, `e8`, `a8`, `n16` (×2) |
| Lecture / écriture données | port sur `cpu.memory` | les 51 sites |
| `push` / `pop` | port, via `Stack` | 2 accès par appel, gratuitement |

**Toutes les instructions purement registre (1 cycle) et immédiates (2 cycles) sont donc
intégralement facturées sans toucher à `instructions.js`.**

### Le piège du câblage

Cinq endroits qui **ne sont pas le CPU** passent aujourd'hui par `cpu.memory` et
factureraient des cycles fantômes :

| Site | Ce qu'il ferait |
|---|---|
| `ppu/index.js` — `get bus()` | chaque `renderLine` et chaque DMA : des centaines de cycles/ligne |
| `machine/index.js` — getters/setters `IE` et `IF` (×4) | 2 cycles par tour de boucle, à chaque `dispatch()` |

Le bus nu doit vivre sur la machine, et ces cinq-là s'y rebranchent. `plugCartridge`
construit aujourd'hui le bus et le passe directement au CPU sans en garder la référence.

---

## 4. La liste manuelle : les cycles internes

C'est **tout ce qui reste à déclarer à la main**. 18 identifiants, pas 501.

> **La colonne « Décomposition » se lit dans l'ordre des M-cycles**, fidèle aux fiches
> gbctr. L'ordre est aujourd'hui inobservable — seule la somme sort de `step()` — mais il
> le deviendra dès que `totalCycles` sera vivant pendant l'instruction : un accès au 3e ou
> au 4e cycle ne lira plus la même valeur de `DIV`. Autant placer juste du premier coup.
>
> La règle à retenir est une symétrie : **sur les empilements l'interne vient AVANT les
> écritures** (c'est le `SP = SP - 1` qui doit précéder) — `RST` et `PUSH` en M2,
> `CALL` en M4. **Sur les dépilements il vient APRÈS les lectures** — `RET` lit ses deux
> octets en M2 et M3, puis transfère dans `PC` en M4. Même coût, ordre opposé.

| id | Total | Décomposition | Internes |
|---|---|---|---|
| `INC_r16` | 2 | fetch + interne | **1** (IDU 16 bits) |
| `DEC_r16` | 2 | fetch + interne | **1** (IDU 16 bits) |
| `ADD_HL_r16` | 2 | fetch + interne | **1** (ALU, moitié basse) |
| `LD_SP_HL` | 2 | fetch + interne | **1** (IDU) |
| `LD_HL_SP_e8` | 3 | fetch + opérande + interne | **1** (ALU) |
| `ADD_SP_e8` | 4 | fetch + opérande + 2 internes | **2** — le seul |
| `JP_n16` | 4 | fetch + 2 opérandes + interne | **1** (`PC = WZ`) |
| `JP_cc_n16` | [4, 3] | fetch + 2 opérandes + interne *si pris* | **1 si pris** |
| `JR_n16` | 3 | fetch + opérande + interne | **1** (ALU) |
| `JR_cc_n16` | [3, 2] | fetch + opérande + interne *si pris* | **1 si pris** |
| `CALL_n16` | 6 | fetch + 2 opérandes + interne + 2 écritures | **1** (`SP = SP-1`) |
| `CALL_cc_n16` | [6, 3] | idem *si pris* ; sinon fetch + 2 opérandes | **1 si pris** |
| `RET` | 4 | fetch + 2 lectures + interne | **1** (`PC = WZ`) |
| `RET_cc` | [5, 2] | fetch + **décision** + (2 lectures + interne *si pris*) | **1 + 1 si pris** |
| `RETI` | 4 | fetch + 2 lectures + interne | **1** |
| `RST_vec` | 4 | fetch + interne + 2 écritures | **1** (`SP = SP-1`) |
| `PUSH_r16` | 4 | fetch + interne + 2 écritures | **1** (`SP = SP-1`) |
| `STOP` | ? | config = `-1` (sentinelle) | à trancher |

### Les cinq pièges de cette liste

1. **`JP_HL` coûte 1 cycle et n'a AUCUN cycle interne.** Le fetch suivant est adressé
   directement par `HL` — le saut est gratuit. C'est la seule instruction de contrôle qui
   ne paie rien. Une implémentation qui facture « tout saut = +1 interne » la casse.

2. **`POP_r16` n'a pas d'interne** (3 = fetch + 2 lectures) alors que **`PUSH_r16` en a un**
   (4 = fetch + interne + 2 écritures). Le décrément de `SP` se paie, l'incrément non.
   Ce n'est pas symétrique.

3. **`RET_cc` a un cycle de *décision***, que la condition soit vraie ou fausse. D'où
   `RET_cc` non pris = 2 (fetch + décision, **aucune lecture**), alors que `JR_cc` non
   pris = 2 aussi mais c'est fetch + **opérande**. Les conditionnels de saut et les
   conditionnels de retour ne facturent pas la même chose : traiter « conditionnel »
   comme un concept unique passe l'un et rate l'autre.

4. **Les opérandes se lisent même quand la condition est fausse.** gbctr insiste :
   « Note that the operand is read even when the condition is false! ». `JP_cc` non pris
   coûte quand même ses 2 octets.

5. **`DI` supprime le check d'interruption** du fetch suivant (gbctr écrit
   `IR = read_memory(...)` au lieu de `fetch_cycle(...)`). Ça ne change pas son coût
   (1 cycle) mais ça touche le dispatch.

---

## 5. Ce que ça change pour les périphériques

L'échantillonnage des interruptions est une **sortie du cycle de fetch** :
`IR, intr = fetch_cycle(addr=PC)`. La ligne est lue au dernier M-cycle de l'instruction,
jamais au milieu. Ta boucle appelle déjà `dispatch()` entre deux `step()` : **tu as déjà
la précision de dispatch**, et la migration ne l'améliore pas.

Le gain réel est ailleurs : ce que le CPU **lit et écrit pendant** l'instruction.
Aujourd'hui `timer.check()` et `ppu.check()` tournent dans `postStep`, donc un
`LDH A,[FF04]` lit un DIV figé à l'état d'avant l'instruction — décalage pouvant aller
jusqu'à la longueur de l'instruction, sur un registre que les jeux lisent comme source
d'aléa. Idem LY et STAT, pollés pour se synchroniser.

Et comme le modèle du timer est **pull** (tout dérive de `machine.totalCycles`), il n'y a
aucun périphérique à faire avancer : il suffit que `totalCycles` soit juste au moment de
l'accès. Le problème se réduit à une ligne, `this.totalCycles += cost` dans `handleTick`,
qui met la date à jour *après* l'instruction au lieu de pendant.

---

## 6. Ordre de travail

1. Donner à la machine une référence au **bus nu**, y rebrancher le PPU et les
   accesseurs `IE`/`IF`.
2. `initMemory(bus)` enveloppe le bus dans le **port qui facture**. `cpu.memory` cesse
   d'être le bus. Rien en aval ne bouge : `Stack` et `decoder.fetch()` en héritent.
3. Déclarer les **18 cycles internes** de la table ci-dessus.
4. Rendre `totalCycles` **dérivé** plutôt que cumulé, pour qu'une lecture au 3e cycle
   d'un `LDH A,[FF04]` voie la date du 3e cycle.
5. Appeler les `check()` au grain cycle — c'est ce qui débloque la fenêtre de 4 T-cycles
   au débordement de TIMA.

Note sur l'observabilité : les étapes 2 et 3 n'ont **aucun effet visible** tant que
l'étape 4 n'est pas faite. Rien ne passera au vert pour dire que ça avance, rien au rouge
pour dire que c'est cassé. Il faut un oracle avant de commencer — les tests d'instructions
tournent déjà à travers le port (`new CPU(buildMemory())` sans cartouche), c'est le bon
niveau pour l'installer.
