// US e-prescribing. Render the options/packages returned by search; confirm a non-controlled package before issuing.
import type {PhysicianClient} from '@natzar/client/physician';
import type {DrugProduct, DrugOption, DrugPackage} from '@natzar/client/contract';

export async function searchPrescriptionDrugs(desk: PhysicianClient, query: string) {
  const status = await desk.prescribing.status();
  if (!status.ready) return {setupUrl: status.setupUrl, requirements: status.requirements};
  return desk.prescribing.searchDrugs(query);
}

export async function issueConfirmedDrug(desk: PhysicianClient, consultationId: string,
  selected: {product: DrugProduct; option: DrugOption; pkg: DrugPackage}) {
  if (selected.option.controlled) throw new Error('Choose a non-controlled medication');
  const {product, option, pkg} = selected;
  return desk.inbox.issuePrescription(consultationId, {draft: {items: [{
    medication: product.name, strength: option.strength, dose: '1 capsule', route: 'oral', frequency: 'bid', quantity: '', refills: 0,
    erx: {ndc: pkg.ndc, drug: pkg.description, unit: option.unit, quantity: '14', daysSupply: 7},
  }]}});
}
// Complete setup before issuing. Issue is never retried automatically; reconcile an ambiguous timeout from the consultation.
