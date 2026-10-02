// Plan §3.4, verbatim (front, 4 lines). Exported so the module is used.
import {NatzarAsync} from '@natzar/client/react';        // patient page; injects /natzar/embed.js once
export const patientPage = <NatzarAsync onMessage={bumpBadge} />;
import {NatzarProvider} from '@natzar/client/react';     // clinician page
export const clinicianPage = <NatzarProvider guardUnload />;
