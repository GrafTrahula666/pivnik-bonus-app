import { chromium } from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
await page.goto(pathToFileURL(resolve('public/icon.svg')).href);
await page.locator('svg').screenshot({path:'public/icon-512.png'});
await browser.close();
