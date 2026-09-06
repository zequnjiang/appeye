import type { StoreName } from '../server/types.js';

export interface LoanFixture {
  title: string;
  description: string;
  country: string;
  store: StoreName;
  externalId: string;
}

const base = { store: 'google-play' as const, externalId: 'fixture.evidence.loan' };

/** Synthetic multilingual descriptions; they are not real lenders or regulatory evidence. */
export const strongLoanFixtures: LoanFixture[] = [
  {
    ...base,
    country: 'th',
    title: 'สินเชื่อทดสอบ',
    description:
      'สมัครสินเชื่อออนไลน์ วงเงินกู้ 5,000 ถึง 50,000 บาท ระยะเวลาชำระคืนขั้นต่ำ 3 เดือน สูงสุด 12 เดือน อัตราดอกเบี้ยสูงสุด 24% ต่อปี ค่าธรรมเนียมการสมัคร 100 บาท ผู้ให้บริการสินเชื่อ: บริษัท ตัวอย่าง ทดสอบ จำกัด',
  },
  {
    ...base,
    country: 'mx',
    title: 'Préstamo de prueba',
    description:
      'Solicita un préstamo personal de 1,000 a 10,000 MXN. Plazo mínimo de pago: 3 meses; plazo máximo: 12 meses. Tasa de interés anual máxima: 30%. Comisión de apertura: 2%. Proveedor del préstamo: Empresa Ficticia de Prueba.',
  },
  {
    ...base,
    country: 'ph',
    title: 'Pautang na Halimbawa',
    description:
      'Mag-apply ng pautang na ₱1,000 hanggang ₱10,000. Panahon ng pagbabayad: 3 hanggang 12 buwan. Pinakamataas na taunang interes: 30%. Bayad sa pagproseso: ₱100. Loan provider: Fictional Lending Corporation. Corporate name: Fictional Lending Corporation. Business name: Example Cash. SEC registration: TEST-ONLY-001. Certificate of Authority: TEST-ONLY-002.',
  },
  {
    ...base,
    country: 'pk',
    title: 'آزمائشی قرض',
    description:
      'قرض کے لیے درخواست دیں۔ قرض کی رقم 1000 سے 10000 روپے ہے۔ واپسی کی مدت کم از کم 3 ماہ اور زیادہ سے زیادہ 12 ماہ ہے۔ زیادہ سے زیادہ سالانہ شرح سود 30% ہے۔ پروسیسنگ فیس 100 روپے ہے۔',
  },
  {
    ...base,
    country: 'id',
    title: 'Pinjaman Contoh',
    description:
      'Ajukan pinjaman tunai Rp1.000.000 hingga Rp5.000.000. Tenor minimum 3 bulan dan maksimum 12 bulan. Suku bunga tahunan maksimum 24%. Biaya administrasi 2%. Penyedia pinjaman: PT Contoh Fiktif. Klaim OJK dalam teks ini adalah data uji, bukan izin yang diverifikasi.',
  },
  {
    ...base,
    country: 'ar',
    title: 'Crédito personal de ejemplo',
    description:
      'Solicitá un préstamo personal desde 10.000 hasta 100.000 ARS. Plazo mínimo de devolución: 3 meses; máximo: 12 meses. Tasa anual máxima: 35%. Comisión de gestión: 2%. Prestamista: Sociedad Ficticia de Prueba.',
  },
];

export const facilitatorFixture: LoanFixture = {
  ...base,
  country: 'ph',
  title: 'Example Loan Marketplace',
  description:
    'We are not a lender and do not lend directly. Apply for a personal loan through our platform: we connect borrowers with third-party lenders. Loan amounts range from 1000 to 10000 pesos. Repayment terms are 3 to 12 months. Maximum annual percentage rate (APR): 24%. Processing fee: 2%.',
};

export const accessoryFixture: LoanFixture = {
  ...base,
  country: 'th',
  title: 'Loan Calculator and Credit Guide',
  description:
    'This is an educational loan calculator and repayment guide only. We do not offer, arrange, facilitate or provide loans. Simulate an example loan of 10000 at 24% APR for 3 to 12 months. The numbers are hypothetical calculations and are not a financial offer.',
};

export const depositFixture: LoanFixture = {
  ...base,
  country: 'id',
  title: 'Credit Your Savings',
  description:
    'Open a savings account and credit your balance. Earn deposit interest of 24% per year on fixed deposits held for 3 to 12 months. This app provides savings and deposit management only, with no loan or borrowing service.',
};

export const amountOnlyFixture: LoanFixture = {
  ...base,
  country: 'mx',
  title: 'Example Personal Loans',
  description:
    'Apply for personal loans from 1000 to 10000 pesos. Over 50000 customers use our platform. The company was founded in 2020. Contact support at 1234567890.',
};
