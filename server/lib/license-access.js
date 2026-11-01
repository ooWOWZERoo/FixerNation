// One definition of "this school's license is open for inviting teachers and registering them".
// Before this, invitations asked "is the invoice paid?" while content access asked "has the PO been received?",
// so a purchase-order school needed staff to do both before it could invite anyone
// (docs/reference/po-license-activation-requirements.md).
//
//   open  =  payment_status is 'paid'
//        OR  the purchase is a PO purchase (payment_method 'po') whose license is active or expiring soon
//
// A PO purchase only becomes 'active' when staff mark the PO received (the cart and quote paths start it at
// 'pending'), so "PO and active" means "the PO has arrived". Payment of the invoice stays a separate, financial
// fact: Mark as Paid still sets payment_status and still triggers the affiliate commission and the paid email.
// A card purchase must have actually paid. Nothing here narrows what was allowed before: anything open under the
// old rule (payment_status 'paid') stays open.
const OPEN_LICENSE_STATUSES = ['active', 'expiring_soon'];

// `purchase` needs payment_status, payment_method and license_status (null license_status counts as 'active').
function licenseAccess(purchase) {
  if (!purchase) return { open: false, reason: 'no_license' };
  if (purchase.payment_status === 'paid') return { open: true, reason: null };
  if (purchase.payment_method === 'po') {
    const status = purchase.license_status || 'active';
    if (OPEN_LICENSE_STATUSES.includes(status)) return { open: true, reason: null };
    return { open: false, reason: 'po_not_received' };
  }
  return { open: false, reason: 'payment_pending' };
}

// SQL fragment for queries that pick purchases by this rule (alias is the purchases table or alias).
function licenseOpenSql(alias) {
  return `(${alias}.payment_status = 'paid' OR (${alias}.payment_method = 'po' AND (${alias}.license_status IS NULL OR ${alias}.license_status IN ('active', 'expiring_soon'))))`;
}

// What an administrator reads when invitations are closed.
const NOT_OPEN_MESSAGES = {
  po_not_received: 'We are waiting to receive your purchase order. You can invite teachers as soon as we have it.',
  payment_pending: 'School license is not yet active. The associated invoice must be marked as paid before invitations can be sent.',
  no_license: 'School license not found.',
};

module.exports = { licenseAccess, licenseOpenSql, NOT_OPEN_MESSAGES, OPEN_LICENSE_STATUSES };
