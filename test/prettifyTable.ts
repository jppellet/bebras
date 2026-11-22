import { prettifyTable } from "../src/prettify"


// separators: | ‖

type TestCase = {
    input: string
    expected?: string
}

const testCases: Array<TestCase> = [
    {
        input: `Tipo di taco        | Ana  | Bet | Carlos
‖:-- ‖ :-: | :-: | :----: ‖
Pollo ![chicken]    | 5    | 3    | 5 \\
Carne ![meat]       | 3    | 5    | 5
|Vegetariano ![vegi]             | 2    | 1   | 11`,
        expected: `‖ Tipo di taco        ‖ Ana | Bet | Carlos ‖
‖ :------------------ ‖ :-: | :-: | :----: ‖
‖ Pollo ![chicken]    ‖ 5   | 3   | 5      ‖\\
‖ Carne ![meat]       ‖ 3   | 5   | 5      ‖
‖ Vegetariano ![vegi] ‖ 2   | 1   | 11     ‖`,
    },

    {
        input: `| Tipo di taco        | Anaaaaaaa  | Beeeeet | Carlos
‖ :-- ‖ :-: | :-: | :----:
Pollo ![chicken]    | 5    | 3    | 5
Carne ![meat]       | 3    | 5    | 5\\
|Vegetarfskfjsdklf jskliano ![vegi]             ||| 1   \\
--`,
        expected: `‖ Tipo di taco     ‖ Anaaaaaaa | Beeeeet | Carlos
‖ :--------------- ‖ :-------: | :-----: | :----:
‖ Pollo ![chicken] ‖ 5         | 3       | 5
‖ Carne ![meat]    ‖ 3         | 5       | 5      \\
‖ Vegetarfskfjsdklf jskliano ![vegi]   ||| 1
‖ ---------------- ‖ --------- | ------- | ------`,
    },

    {
        input: `^--:|^---+
![expl2] |Per primo sceglie inglese ![english], il compito più veloce di tutti.
![expl3]| Poi sceglie il compito di musica ![music]. Quando lo ha finito, ha lavorato in tutto 45 minuti.
![expl4]|Sceglie il compito successivo: matematica ![math].
![expl5]|Dopo 5 minuti di calcoli concentrati, si ricorda della passeggiata di 20 minuti con il cane. Questo compito viene aggiunto alla lista rimanente e messo al primo posto, in base al tempo che richiede.
![expl6]|Ora Sarah porta a spasso il cane ![walkthedog].
![expl7]|Poi sceglie il compito successivo della lista, ovvero chimica ![Science].`,
        expected: `^------: | ^-------------------------------------------------------------------+
![expl2] | Per primo sceglie inglese ![english], il compito più veloce di tutti.
![expl3] | Poi sceglie il compito di musica ![music]. Quando lo ha finito, ha lavorato in tutto 45 minuti.
![expl4] | Sceglie il compito successivo: matematica ![math].
![expl5] | Dopo 5 minuti di calcoli concentrati, si ricorda della passeggiata di 20 minuti con il cane. Questo compito viene aggiunto alla lista rimanente e messo al primo posto, in base al tempo che richiede.
![expl6] | Ora Sarah porta a spasso il cane ![walkthedog].
![expl7] | Poi sceglie il compito successivo della lista, ovvero chimica ![Science].`,
    },

    {
        input: `    | Schritt | Beispiel
^-: | ^-----+ | :----------
1 | Nimm die erste Münze von links, die am falschen Platz liegt. Lege sie nach oben, über ihren richtigen Platz.  Ein Platz wird frei. | ![coins_1b]
2 | Lege so lange die richtige Münze auf den aktuell freien Platz (und mache dadurch einen anderen Platz frei), bis der Platz unter der nach oben gelegten Münze frei wird. | ![coins_1c]
    |         | ![coins_1d]
3 | Lege die Münze von oben nun auf den freien, richtigen Platz. Damit ist die Runde zu Ende, und alle Plätze sind wieder belegt. | ![coins_1e]
^-: | ^-----+ | :----------`,
        expected: `    | Schritt | Beispiel
^-: | ^-----+ | :----------
1   | Nimm die erste Münze von links, die am falschen Platz liegt. Lege sie nach oben, über ihren richtigen Platz.  Ein Platz wird frei. | ![coins_1b]
2   | Lege so lange die richtige Münze auf den aktuell freien Platz (und mache dadurch einen anderen Platz frei), bis der Platz unter der nach oben gelegten Münze frei wird. | ![coins_1c]
    |         | ![coins_1d]
3   | Lege die Münze von oben nun auf den freien, richtigen Platz. Damit ist die Runde zu Ende, und alle Plätze sind wieder belegt. | ![coins_1e]
--- | ------- | -----------`,
    },

    {
        input: `-- | ------------- | --
1. | Höhle         | \`––|\`
2. | Statue        | \`|––|\` 
3. | Felsen        | \`|–––\`
4. | Springbrunnen | \`–|–|\`
5. | Baumgruppe    | \`–|––\`
6. | Brücke        | \`–––\``,
        expected: `--- | ------------- | ------
1.  | Höhle         | \`––|\`
2.  | Statue        | \`|––|\`
3.  | Felsen        | \`|–––\`
4.  | Springbrunnen | \`–|–|\`
5.  | Baumgruppe    | \`–|––\`
6.  | Brücke        | \`–––\``,
    },

    {
        input: `:-: | ^---------+
![grundriss] | Dies ist der Grundriss der Eingangshalle. Die Wände, die Tür links, die Fenster (oben und unten) und die Aufzüge (rechts) sind Hindernisse für den Roboter. \\\\
  | Die rote Line zeigt, wie der Roboter heute gefahren ist.`,
        expected: `:----------: | ^------------------------------------------------------+
![grundriss] | Dies ist der Grundriss der Eingangshalle. Die Wände, die Tür links, die Fenster (oben und unten) und die Aufzüge (rechts) sind Hindernisse für den Roboter. \\\\
             | Die rote Line zeigt, wie der Roboter heute gefahren ist.`,
    },

    {
        input: `:v----: | :-----------------------
A)  | ![answerA]
B)  | ![answerB]
C)  | ![answerC]
D)  | ![answerD]`,
        expected: `:v-: | :---------
A)   | ![answerA]
B)   | ![answerB]
C)   | ![answerC]
D)   | ![answerD]`,
    },

    {
        input: `| Person | Videos |||
|:---|:---|:---|:---|
| Anna | ![videoB] | ![videoC] | ![videoE] |`,
        expected: `Person | Videos                          |||
:----- | :-------- | :-------- | :-------- |
Anna   | ![videoB] | ![videoC] | ![videoE] |`,
    },

    {
        input: `Person | Videos                          |||
:----- | :-------- | :-------- | :--------
Anna   | ![videoB] | ![videoC] | ![videoE]`,
        expected: `Person | Videos                          |||
:----- | :-------- | :-------- | :-------- |
Anna   | ![videoB] | ![videoC] | ![videoE] |`,
    },

]


let n = 0
const len = testCases.length
let numFailed = 0
for (const { input, expected } of testCases) {
    n++
    console.log(`Test ${n} of ${len}`)
    const actual = prettifyTable(input, "\n", false)
    if (expected === undefined || expected === "") {
        console.log(`\n\n` + actual + `\n`)
    } else {
        if (actual !== expected) {
            console.log(" -> Test failed: actual output differs from input")
            console.log(`\n\nInput:\n` + input + `\n`)
            console.log(`\n\nActual:\n` + actual + `\n`)
            console.log(`\n\nExpected:\n` + expected + `\n`)
            console.log(`\nLog:`)
            prettifyTable(input, "\n", true)
            numFailed++
        } else {
            console.log(" -> Test passed")
        }
    }
}

const allTestsPassed = numFailed === 0
if (allTestsPassed) {
    console.log(`All ${len} tests passed.`)
} else {
    console.log(`${numFailed} of ${len} tests failed.`)
}