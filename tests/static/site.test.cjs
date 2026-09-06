'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../../assets/js/site.js');
// Isolated invented data only. No network connections and no messages are sent.
const good = {whatsappVerified:true, whatsappNumber:'12025550123', founderImageApproved:true,
 founderImage:'assets/images/founder-approved.webp', locationVerified:true,
 legalReviewApproved:true, publicationApproved:true};
for (const [query, fallback, result] of [
 ['',undefined,'he'],['?lang=en','he','en'],['?lang=he','en','he'],['?lang=fr','en','en'],
 ['?lang=<script>','he','he'],['?lang=EN','he','he'],['?other=en',undefined,'he'],
 ['?lang=en&child=DO_NOT_FORWARD','he','en']]) {
 test(`locale ${JSON.stringify(query)} ${fallback}`,()=>assert.equal(api.chooseLocale(query,fallback),result));
}
test('verified phone becomes direct WhatsApp URL, without a message or query',()=>assert.equal(api.contactUrl(good),'https://wa.me/12025550123'));
for (const value of ['',null,undefined,12025550123,'+12025550123','0123456789','1202 555 0123','12025550123?text=private','https://wa.me/12025550123','12025550123\n','../../x','javascript:alert(1)','1234567','1234567890123456']) {
 test(`reject malformed phone ${JSON.stringify(value)}`,()=>assert.equal(api.contactUrl({...good,whatsappNumber:value}),null));
}
test('unapproved phone remains disabled',()=>assert.equal(api.contactUrl({...good,whatsappVerified:false}),null));
test('truthy text is not verification',()=>assert.equal(api.contactUrl({...good,whatsappVerified:'true'}),null));
test('missing config fails closed',()=>assert.equal(api.contactUrl(undefined),null));
test('approved local raster allowed',()=>assert.equal(api.photoPath(good),'assets/images/founder-approved.webp'));
for (const value of ['https://example.invalid/founder.jpg','assets/images/../private.jpg','assets/images/founder.svg','data:image/png;base64,x','/assets/images/a.png','assets/images/a.jpg?person=private','assets/images/a.png\n','']) {
 test(`reject unsafe image ${JSON.stringify(value)}`,()=>assert.equal(api.photoPath({...good,founderImage:value}),null));
}
test('unapproved image rejected',()=>assert.equal(api.photoPath({...good,founderImageApproved:false}),null));
test('default settings return all five blockers',()=>assert.deepEqual(api.publicationProblems({}),['CONTACT_UNVERIFIED','FOUNDER_PHOTO_UNVERIFIED','LOCATION_UNVERIFIED','LEGAL_REVIEW_UNVERIFIED','PUBLICATION_NOT_AUTHORIZED']));
test('complete synthetic approvals clear configuration gate',()=>assert.deepEqual(api.publicationProblems(good),[]));
for (const flag of ['whatsappVerified','founderImageApproved','locationVerified','legalReviewApproved','publicationApproved']) {
 test(`missing ${flag} blocks publication`,()=>assert.equal(api.publicationProblems({...good,[flag]:false}).length,1));
}
