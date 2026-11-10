# Actual Budget Tendances — moteur de calcul

Petit moteur TypeScript pur pour agréger des transactions Actual par mois et par catégorie. Il ne dépend ni de Svelte, ni d'une interface graphique, ni de bibliothèques externes. Il reçoit des objets déjà récupérés par l'API Actual.

## Règles

- Les montants d'Actual sont des entiers en cents. Le moteur inverse le signe : une dépense Actual négative devient positive, un remboursement positif devient négatif.
- Les remboursements diminuent le total net du mois. Un mois peut donc avoir un total négatif ; aucune valeur absolue n'est appliquée.
- Les transferts (`transfer_id`) et tombstones sont ignorés.
- Pour les fractions, les enfants sont comptés et le parent est ignoré. Si les enfants sont imbriqués dans `subtransactions`, ils sont développés ; les IDs empêchent un double comptage si l'appelant fournit aussi ces enfants séparément.
- Les comptes hors budget et les transactions sans catégorie sont ignorés par défaut. Les options `includeOffBudget` et `includeUncategorized` permettent de les inclure. L'appelant transmet les IDs hors budget dans `offBudgetAccountIds` (obtenus depuis la table Actual `accounts`).
- Les mois sont complétés par des zéros de `startMonth` à `endMonth`. La borne de fin est inclusive, mais le mois courant et les mois futurs sont retirés automatiquement.
- La médiane est calculée sur les mois strictement positifs. À une tolérance de 1, la détection est désactivée ; sinon, une anomalie est une valeur strictement hors de `médiane ± tolérance × médiane`. Les zéros et valeurs négatives ne sont pas marqués comme anomalies.
- Les moyennes mobiles utilisent les valeurs mensuelles réelles, anomalies incluses, et attendent une fenêtre complète. La moyenne globale épurée exclut les anomalies, mais garde les mois à zéro.
- Les moyennes sont arrondies au centime le plus proche. Les opérations de somme utilisent des entiers sûrs JavaScript et lèvent une erreur si leur plage est dépassée.

La détection reprend la logique de `tendance.py`, avec deux choix rendus explicites : la tolérance par défaut vaut 1 (détection désactivée, comme dans le script actuel), et les mois de remboursement net négatif restent négatifs au lieu de prendre une valeur absolue. Le script Python traite aussi différemment « toutes les dépenses » et une catégorie spécifique ; ce moteur applique une règle unique aux transactions normalisées.

## API du moteur

- `normalizeTransactions(rows, options)` convertit le sous-ensemble de champs Actual requis vers des flux normalisés.
- `analyzeSpending(rows, options)` réalise la normalisation, l'agrégation, la détection et les calculs de tendance.
- `AnalysisOptions` accepte `startMonth`, `endMonth`, `currentMonth` (utile pour rendre les tests déterministes), `tolerance`, et les options de comptes/catégories.

Les dates de transaction doivent être de vraies dates ISO `YYYY-MM-DD`. Les mois sont au format `YYYY-MM`. Les valeurs `amount` doivent être des entiers sûrs en cents.

## Tests

Node.js 22.6 ou plus récent est requis pour l'effacement intégré des types TypeScript. Aucune dépendance n'est nécessaire :

```sh
npm test
```

Ou directement :

```sh
node --experimental-strip-types --test test/*.test.ts
```

Les fixtures de `test/fixtures.ts` illustrent une série de type CSV Python : dépenses mensuelles, mois sans transaction, pic anormal et remboursement.
