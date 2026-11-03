#!/usr/bin/env node
// One canonical guest UI serves the hosted page and the SDK. Checked copies
// make the published package self-contained, just like the API contract.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = join(repo, 'packages/natzar-client/src/guest-ui');
mkdirSync(target, {recursive: true});
const files = ['GuestJourney.tsx', 'GuestCareOptions.tsx', 'GuestOverlay.tsx', 'HistoryDialog.tsx', 'GuestAccountFrame.tsx', 'SignupFields.tsx', 'RequiredMark.tsx', 'GuestSingleSelect.tsx', 'GuestDialog.tsx', 'BirthdateInput.tsx', 'signup-copy.ts', 'login-copy.ts', 'PhoneInput.tsx', 'history-copy.ts', 'modal-scroll.ts', 'form-focus.ts', 'QuickIntake.tsx', 'IntakeSelect.tsx', 'intake-copy.ts', 'IdentityForm.tsx', 'GuestCheckout.tsx', 'copy.ts', 'consent-copy.ts', 'styles.ts'];
const copies = files.map(file => ({file, source: join(repo, 'frontend/guest', file)}));
copies.push({file: 'country-flag-assets.ts', source: join(repo, 'frontend/patient-interface/welcome/country-flag-assets.ts')});
copies.push({file: 'birthdate-calendar.ts', source: join(repo, 'frontend/shared/birthdate-calendar.ts')});
copies.push({file: 'flowbite-datepicker.d.ts', source: join(repo, 'frontend/patient-interface/flowbite-datepicker.d.ts')});
copies.push({file: 'jurisdictions.ts', source: join(repo, 'shared/jurisdictions.ts')});
copies.push({file: 'login-policy.ts', source: join(repo, 'shared/patient-login.ts')});
for (const file of ['AgentWelcome.tsx', 'ChatComposer.tsx', 'chat-copy.ts']) copies.push({file, source: join(repo, 'frontend/partner-embed', file)});
copies.push({file: 'emphasis.tsx', source: join(repo, 'frontend/partner-embed/emphasis.tsx')});
copies.push({file: 'payment-dialog.ts', source: join(repo, 'frontend/embed-core/loader/payment-dialog.ts')});
copies.push({file: 'frame-fill.ts', source: join(repo, 'frontend/embed-core/loader/fill.ts')});
for (const file of ['patient-sex.ts', 'signup-medication-questions.ts', 'guest-phone.ts', 'guest-signup.ts', 'guest-intake.ts', 'signup-catalogue.ts', 'searchable-selection.ts', 'selection-order.ts']) copies.push({file, source: join(repo, 'shared', file)});
const check = process.argv.includes('--check');
const drifted = [];
for (const {file, source} of copies) {
  const content = '// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.\n' + readFileSync(source, 'utf8')
    .replaceAll("'../../shared/guest'", "'../contract/guest'")
    .replaceAll("'./guest'", "'../contract/guest'")
    .replaceAll("'./partner-api/model-values'", "'../contract/model-values'")
    .replaceAll("'../../shared/guest-intake'", "'./guest-intake'")
    .replaceAll("'../../shared/guest-phone'", "'./guest-phone'")
    .replaceAll("'../../shared/guest-signup'", "'./guest-signup'")
    .replaceAll("'../../shared/patient-sex'", "'./patient-sex'")
    .replaceAll("'../../shared/selection-order'", "'./selection-order'")
    .replaceAll("'../../shared/signup-medication-questions'", "'./signup-medication-questions'")
    .replaceAll("'../shared/birthdate-calendar'", "'./birthdate-calendar'")
    .replaceAll("'../patient-interface/welcome/country-flag-assets'", "'./country-flag-assets'")
    .replaceAll("import zip3States from './us-zip3-states.json';", "import {zip3States} from './guest-postal-data';")
    .replaceAll("import zipExclusions from './us-zip-exclusions.json';", "import {zipExclusions} from './guest-postal-data';")
    .replaceAll("'../../shared/signup-catalogue'", "'./signup-catalogue'")
    .replaceAll("'../../shared/searchable-selection'", "'./searchable-selection'")
    .replaceAll("import catalogue from './signup-catalogue.json';", "import {catalogue} from './intake-catalogue-data';")
    .replaceAll("import medicationsCa from './signup-medications-ca.json';", "import {medicationsCa} from './intake-catalogue-data';")
    .replaceAll("import medicationsUs from './signup-medications-us.json';", "import {medicationsUs} from './intake-catalogue-data';")
    .replaceAll("'../../shared/jurisdictions'", "'./jurisdictions'")
    .replaceAll("'../../shared/patient-login'", "'./login-policy'")
    .replaceAll("'../partner-embed/emphasis'", "'./emphasis'")
    .replaceAll("'../partner-embed/AgentWelcome'", "'./AgentWelcome'")
    .replaceAll("'../partner-embed/ChatComposer'", "'./ChatComposer'")
    .replaceAll("'../partner-embed/chat-copy'", "'./chat-copy'")
    .replace(/import (en|fr|es|de|it) from '\.\/locales\/(en|fr|es|de|it)\.json';/g, "import {$1} from './chat-locales-data';")
    .replaceAll("'../embed-core/loader/fill'", "'./frame-fill'")
    .replaceAll("'../embed-core/loader/payment-dialog'", "'./payment-dialog'")
    .replaceAll("from './fill'", "from './frame-fill'")
    .replaceAll("'../../packages/natzar-client/src/guest/index'", "'../guest/index'")
    .replace(/import (en|fr|es|de|it) from '\.\.\/form\/src\/locales\/(en|fr|es|de|it)\.json';/g, "import {$1} from './intake-locales-data';");
  const dest = join(target, file);
  let current; try {current = readFileSync(dest, 'utf8');} catch { /* First generation. */ }
  if (current === content) continue;
  if (check) drifted.push(file); else writeFileSync(dest, content);
}
// Checked TypeScript data keeps the npm package independent of JSON loader
// support and carries only the signup catalogue labels, not its whole renderer.
const dataFiles = [
  {file: 'chat-locales-data.ts', content: ['en', 'fr', 'es', 'de', 'it'].map(language => {const resource = JSON.parse(readFileSync(join(repo, 'frontend/partner-embed/locales', `${language}.json`), 'utf8')); return `export const ${language} = ${JSON.stringify({embed: {agent: resource.embed.agent, chat: resource.embed.chat}})};`;}).join('\n')},
  {file: 'guest-postal-data.ts', content: [['zip3States', 'us-zip3-states.json'], ['zipExclusions', 'us-zip-exclusions.json']].map(([name, file]) => `export const ${name} = ${readFileSync(join(repo, 'shared', file), 'utf8').trim()};`).join('\n')},
  {file: 'intake-catalogue-data.ts', content: [['catalogue', 'signup-catalogue.json'], ['medicationsCa', 'signup-medications-ca.json'], ['medicationsUs', 'signup-medications-us.json']].map(([name, file]) => `export const ${name} = ${readFileSync(join(repo, 'shared', file), 'utf8').trim()};`).join('\n')},
  {file: 'intake-locales-data.ts', content: ['en', 'fr', 'es', 'de', 'it'].map(language => {const resource = JSON.parse(readFileSync(join(repo, 'frontend/form/src/locales', `${language}.json`), 'utf8')); return `export const ${language} = ${JSON.stringify({signup: {catalogue: resource.signup.catalogue, choices: resource.signup.choices, medications: resource.signup.medications, blocks: {signupAllergiesOther: resource.signup.blocks.signupAllergiesOther}}})};`;}).join('\n')},
];
for (const {file, content} of dataFiles) {
  const wanted = '// GENERATED FILE — canonical signup catalogue and translations; run sync-contract.\n' + content + '\n';
  const dest = join(target, file);
  let current; try {current = readFileSync(dest, 'utf8');} catch { /* First generation. */ }
  if (wanted === current) continue;
  if (check) drifted.push(file); else writeFileSync(dest, wanted);
}
if (drifted.length) {console.error(`Guest UI copies are out of date: ${drifted.join(', ')}. Run npm run sync-contract.`); process.exit(1);}
