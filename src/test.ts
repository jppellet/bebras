#! /usr/bin/env node

import fs = require('fs');
import _ = require('lodash');
import { RichStringEnum } from './util';

testRichEnum();
console.log("Done.");


function testRichEnum() {
    type Month = "December" | "March" | "June" | "September";

    const Seasons = RichStringEnum.withProps<{
        temperature: number
        startMonth: Month
    }>()({
        winter: { temperature: 5, startMonth: "December" },
        spring: { temperature: 20, startMonth: "March" },
        summer: { temperature: 30, startMonth: "June" },
        fall: { temperature: 15, startMonth: "September" },
    });
    // .withMethods({
    //     minTemp() {
    //         return _.min(Seasons.definitions.map(v => v[1].temperature))
    //     },
    // })

    type Season = typeof Seasons.type;

    const ss: string = "jj";

    if (Seasons.isValue(ss)) {
        Seasons.propsOf(ss).temperature;
    } 

    const s = Seasons[0];

    console.log(Seasons);
    console.log(s);
    console.log(Seasons.propsOf(s).startMonth);
    console.log([...Seasons]);
    // console.log(Seasons.minTemp())
}
