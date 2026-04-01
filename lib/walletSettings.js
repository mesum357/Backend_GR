const AppSettings = require('../models/AppSettings');

const DEFAULT_DRIVER_MINIMUM_WALLET_PKR = 500;

/** Defaults used when DB is empty or fields are missing (matches previous hardcoded EasyPaisa) */
const DEFAULT_PAYMENT_METHODS = {
  easypaisa: {
    accountNumber: '03001234567',
    accountHolder: 'Tourist Rides',
    instructions: '',
  },
  jazzcash: {
    accountNumber: '',
    accountHolder: '',
    instructions: '',
  },
  bank: {
    bankName: '',
    accountTitle: '',
    accountNumber: '',
    iban: '',
    branch: '',
    instructions: '',
  },
};

function trimStr(v, max = 2000) {
  if (v == null) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function mergePaymentMethodsFromDoc(doc) {
  const raw = (doc && doc.paymentMethods) || {};
  return {
    easypaisa: {
      ...DEFAULT_PAYMENT_METHODS.easypaisa,
      accountNumber: trimStr(raw.easypaisa?.accountNumber, 80) || DEFAULT_PAYMENT_METHODS.easypaisa.accountNumber,
      accountHolder: trimStr(raw.easypaisa?.accountHolder, 200) || DEFAULT_PAYMENT_METHODS.easypaisa.accountHolder,
      instructions: trimStr(raw.easypaisa?.instructions, 2000),
    },
    jazzcash: {
      ...DEFAULT_PAYMENT_METHODS.jazzcash,
      accountNumber: trimStr(raw.jazzcash?.accountNumber, 80),
      accountHolder: trimStr(raw.jazzcash?.accountHolder, 200),
      instructions: trimStr(raw.jazzcash?.instructions, 2000),
    },
    bank: {
      ...DEFAULT_PAYMENT_METHODS.bank,
      bankName: trimStr(raw.bank?.bankName, 200),
      accountTitle: trimStr(raw.bank?.accountTitle, 200),
      accountNumber: trimStr(raw.bank?.accountNumber, 80),
      iban: trimStr(raw.bank?.iban, 80),
      branch: trimStr(raw.bank?.branch, 200),
      instructions: trimStr(raw.bank?.instructions, 2000),
    },
  };
}

/**
 * @returns {Promise<number>}
 */
async function getDriverMinimumWalletPkr() {
  try {
    const doc = await AppSettings.findById('singleton').lean();
    if (!doc) return DEFAULT_DRIVER_MINIMUM_WALLET_PKR;
    const v = Number(doc.driverMinimumWalletPkr);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DRIVER_MINIMUM_WALLET_PKR;
  } catch (e) {
    console.error('getDriverMinimumWalletPkr:', e);
    return DEFAULT_DRIVER_MINIMUM_WALLET_PKR;
  }
}

/**
 * @param {unknown} raw
 * @returns {Promise<number>}
 */
async function setDriverMinimumWalletPkr(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) {
    const err = new Error('driverMinimumWalletPkr must be a number between 0 and 10,000,000');
    err.statusCode = 400;
    throw err;
  }
  await AppSettings.findOneAndUpdate(
    { _id: 'singleton' },
    { $set: { driverMinimumWalletPkr: Math.round(n * 1000) / 1000 } },
    { upsert: true, new: true }
  );
  return n;
}

/**
 * Merged payment methods for API / admin (defaults applied).
 * @returns {Promise<typeof DEFAULT_PAYMENT_METHODS>}
 */
async function getMergedPaymentMethods() {
  const doc = await AppSettings.findById('singleton').lean();
  return mergePaymentMethodsFromDoc(doc);
}

/**
 * Payload for GET /api/driver/wallet/payment-details
 */
async function getDriverPaymentDetailsPayload() {
  const pm = await getMergedPaymentMethods();
  return {
    minimumAmount: 100,
    maximumAmount: 50000,
    methods: ['easypaisa', 'jazzcash', 'bank_transfer'],
    easypaisa: pm.easypaisa,
    jazzcash: pm.jazzcash,
    bank: pm.bank,
    instructions: [
      '1. Choose your payment method below',
      '2. Send the amount to the account details shown',
      '3. Note your transaction ID from the receipt',
      '4. Enter your name, amount, transaction ID, and upload a screenshot',
      '5. Your request will be processed after verification',
    ],
  };
}

const ALLOWED_CASH_IN = new Set(['easypaisa', 'jazzcash', 'bank_transfer']);

/**
 * Snapshot account fields stored on the wallet transaction for admin review.
 * @param {'easypaisa'|'jazzcash'|'bank_transfer'} method
 */
async function getCashInSnapshotForMethod(method) {
  if (!ALLOWED_CASH_IN.has(method)) {
    const err = new Error('Invalid payment method');
    err.statusCode = 400;
    throw err;
  }
  const pm = await getMergedPaymentMethods();
  if (method === 'easypaisa') {
    return {
      accountNumber: pm.easypaisa.accountNumber || DEFAULT_PAYMENT_METHODS.easypaisa.accountNumber,
      accountHolder: pm.easypaisa.accountHolder || DEFAULT_PAYMENT_METHODS.easypaisa.accountHolder,
      reference: '',
    };
  }
  if (method === 'jazzcash') {
    return {
      accountNumber: pm.jazzcash.accountNumber || '—',
      accountHolder: pm.jazzcash.accountHolder || '—',
      reference: '',
    };
  }
  const b = pm.bank;
  const refParts = [b.iban, b.branch].filter(Boolean);
  return {
    accountNumber: b.accountNumber || '—',
    accountHolder: b.accountTitle || b.bankName || '—',
    reference: refParts.join(' | '),
  };
}

function sanitizeIncomingPaymentMethods(body) {
  if (!body || typeof body !== 'object') {
    const err = new Error('paymentMethods must be an object');
    err.statusCode = 400;
    throw err;
  }
  return {
    easypaisa: {
      accountNumber: trimStr(body.easypaisa?.accountNumber, 80),
      accountHolder: trimStr(body.easypaisa?.accountHolder, 200),
      instructions: trimStr(body.easypaisa?.instructions, 2000),
    },
    jazzcash: {
      accountNumber: trimStr(body.jazzcash?.accountNumber, 80),
      accountHolder: trimStr(body.jazzcash?.accountHolder, 200),
      instructions: trimStr(body.jazzcash?.instructions, 2000),
    },
    bank: {
      bankName: trimStr(body.bank?.bankName, 200),
      accountTitle: trimStr(body.bank?.accountTitle, 200),
      accountNumber: trimStr(body.bank?.accountNumber, 80),
      iban: trimStr(body.bank?.iban, 80),
      branch: trimStr(body.bank?.branch, 200),
      instructions: trimStr(body.bank?.instructions, 2000),
    },
  };
}

/**
 * Admin: full wallet settings document
 */
async function getAdminWalletSettings() {
  const driverMinimumWalletPkr = await getDriverMinimumWalletPkr();
  const paymentMethods = await getMergedPaymentMethods();
  return { driverMinimumWalletPkr, paymentMethods };
}

/**
 * Admin: patch any subset of settings
 * @param {{ driverMinimumWalletPkr?: unknown, paymentMethods?: object }} body
 */
async function patchAdminWalletSettings(body) {
  const patch = {};
  if (body && body.driverMinimumWalletPkr !== undefined) {
    const n = Number(body.driverMinimumWalletPkr);
    if (!Number.isFinite(n) || n < 0 || n > 10000000) {
      const err = new Error('driverMinimumWalletPkr must be a number between 0 and 10,000,000');
      err.statusCode = 400;
      throw err;
    }
    patch.driverMinimumWalletPkr = Math.round(n * 1000) / 1000;
  }
  if (body && body.paymentMethods !== undefined) {
    patch.paymentMethods = sanitizeIncomingPaymentMethods(body.paymentMethods);
  }
  if (Object.keys(patch).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }
  await AppSettings.findOneAndUpdate({ _id: 'singleton' }, { $set: patch }, { upsert: true, new: true });
  return getAdminWalletSettings();
}

module.exports = {
  getDriverMinimumWalletPkr,
  setDriverMinimumWalletPkr,
  DEFAULT_DRIVER_MINIMUM_WALLET_PKR,
  getMergedPaymentMethods,
  getDriverPaymentDetailsPayload,
  getCashInSnapshotForMethod,
  getAdminWalletSettings,
  patchAdminWalletSettings,
  DEFAULT_PAYMENT_METHODS,
};
