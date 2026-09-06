import catalog from './policy-catalog.json' with { type: 'json' };

export interface LoanInput {
  title: string;
  summary?: string | null;
  description?: string | null;
  genre?: string | null;
  country: string;
  store: 'google-play' | 'app-store';
  externalId: string;
  sourceKeyword?: string | null;
  raw?: unknown;
  observedAt?: string;
}
export interface LoanEvidence {
  id: string;
  kind: string;
  field: string;
  text: string;
  start: number;
  end: number;
  source: 'description' | 'title' | 'summary';
  weight: number;
  numericValue?: number;
  rateType?: string;
  unit?: string;
}
export interface LoanAnalysis {
  classification: 'confirmed' | 'candidate';
  verdict: 'strong' | 'possible' | 'insufficient';
  confidence: number;
  ruleVersion: string;
  analyzedAt: string;
  sourceObservedAt: string | null;
  summary: string;
  productType: string;
  evidence: LoanEvidence[];
  policyRetrievedAt: string;
  countryPolicyNote: string;
  disclosures: {
    ruleId: string;
    title: string;
    sourceUrl: string;
    scope: string;
    status: 'observed' | 'not_observed' | 'conditional' | 'not_applicable';
    fields: string[];
    observedFields: string[];
    missingFields: string[];
    note: string;
  }[];
  entities: {
    role:
      'loanProvider' | 'developerLegalEntity' | 'corporateName' | 'businessName' | 'regulatorClaim';
    name: string;
    source: 'description';
    evidenceId: string;
    verified: false;
  }[];
  limitations: string[];
  sources: { title: string; url: string }[];
  store: string;
  country: string;
}

// These are transparent extraction heuristics, not regulatory facts. Policy expectations
// live separately in the versioned catalog. All offsets refer to the original source text.
const loan =
  /\b(?:loans?|borrow(?:ing|ers?)?|lend(?:ing|ers?)?|personal credit|cash advance|pr[eé]stamos?|cr[eé]ditos?|pinjam(?:an)?|kredit|pautang|utang)\b|สินเชื่อ|เงินกู้|กู้เงิน|ยืมเงิน|เงินด่วน|قرض|ادھار/iu;
const intent =
  /\b(?:apply|borrow|connect|match|solicit[aáe](?:r)?|obt[eé]n|recibe|ajukan|pengajuan|dapatkan|pinjam|mag-apply|humiram)\b|solicit[aáe](?:r)?(?=\s)|สมัคร|ขอสินเชื่อ|ขอกู้|ให้บริการสินเชื่อ|درخواست|حاصل|لیں/iu;
const accessory =
  /\b(?:calculator|guide|educational|simulation|simulat[eo]|calculadora|simulador|kalkulator|panduan)\b|เครื่องคำนวณ|เครื่องคิดเลข/iu;
const noService =
  /(?:do not|does not|don't|no)\s+(?:offer|arrange|facilitate|provide|loan|borrowing)|only.*(?:calculator|guide)|(?:calculator|guide).*only|no (?:otorgamos|ofrecemos)|tidak (?:memberikan|menyediakan)/iu;
const apr =
  /\bAPR\b|annual percentage rate|tasa (?:de )?(?:porcentaje|anual equivalente)|tahunan efektif/iu;
const interest = /interest|inter[eé]s|tasa(?: anual)?|interes|suku bunga|bunga|ดอกเบี้ย|شرح سود/iu;
const rateContext =
  /\bAPR\b|annual percentage rate|interest|inter[eé]s|tasa|interes|suku bunga|bunga|ดอกเบี้ย|شرح سود|\b(?:CAT|CFT|TNA|TEA)\b/iu;
const max =
  /max(?:imum|ima|imo|[ií]m[ao]|imum)?|m[aá]xim[ao]|pinakamataas|สูงสุด|มากที่สุด|زیادہ سے زیادہ/iu;
const annual = /annual|anual|year|tahun|taunang|ต่อปี|سالانہ/iu;
const fee =
  /fees?|charges?|commissions?|comisi[oó]n|cost[eo]s?|biaya|bayad|ค่าธรรมเนียม|ค่าใช้จ่าย|فیس/iu;
const term =
  /repay|payment term|loan term|tenor|plazo|devoluci[oó]n|pago|pagbabayad|ชำระคืน|ระยะเวลา|واپسی|مدت/iu;
const numeric = /\d+(?:[.,]\d+)?/u;
const units =
  /\d+(?:[.,]\d+)?\s*(?:days?|months?|years?|d[ií]as?|mes(?:es)?|a[nñ]os?|hari|bulan|tahun|buwan|araw|วัน|เดือน|ปี|ماہ|دن|سال)/giu;

function clauses(text: string): { text: string; start: number }[] {
  // Do not split decimal points. Bound work for untrusted store descriptions.
  return [...text.slice(0, 100_000).matchAll(/[^\n;。۔.!?]+(?:\.(?=\d)[^\n;。۔.!?]*)*/gu)].map(
    (m) => ({ text: m[0], start: m.index! }),
  );
}

export function classifyLoan(input: LoanInput): LoanAnalysis {
  const evidence: LoanEvidence[] = [],
    entities: LoanAnalysis['entities'] = [];
  const observed = new Set<string>(),
    families = new Set<string>();
  const desc = input.description || '';
  const all = [input.title, input.summary, desc].filter(Boolean).join('\n');
  const facilitator =
    /(?:connect|match)(?:s|ing)?\s+[^.!?\n]{0,70}(?:borrowers?|lenders?)|conectamos[^.!?\n]{0,70}prestamistas|mempertemukan[^.!?\n]{0,70}peminjam/iu.test(
      desc,
    );
  const hasLoan = loan.test(all),
    hasIntent = intent.test(desc) && (!noService.test(desc) || facilitator);
  const isAccessory = accessory.test(all) && ((noService.test(desc) && !facilitator) || !hasIntent);
  const productType = isAccessory
    ? 'accessory'
    : /earned wage|salary advance|earned pay|adelanto de salario/iu.test(all)
      ? 'earned-wage-access'
      : /mortgage|hipoteca|auto loan|car loan|cr[eé]dito automotriz/iu.test(all) &&
          !/personal loan|pr[eé]stamo personal/iu.test(desc)
        ? 'secured-loan'
        : /credit card|revolving credit|tarjeta de cr[eé]dito/iu.test(all) &&
            (!/personal loan|pr[eé]stamo personal/iu.test(desc) ||
              /not (?:an? )?(?:installment )?personal loan/iu.test(desc))
          ? 'revolving-credit'
          : hasLoan
            ? 'personal-loan-or-facilitator'
            : 'unknown';
  function add(
    kind: string,
    field: string,
    source: LoanEvidence['source'],
    text: string,
    start: number,
    weight = 0,
    extra: Partial<LoanEvidence> = {},
  ) {
    const e: LoanEvidence = {
      id: `E${evidence.length + 1}`,
      kind,
      field,
      source,
      text,
      start,
      end: start + text.length,
      weight,
      ...extra,
    };
    evidence.push(e);
    if (source === 'description') observed.add(field);
    return e;
  }
  for (const source of ['title', 'summary', 'description'] as const) {
    const text = input[source] || '';
    const m = loan.exec(text);
    if (m) add('context', 'loanContext', source, m[0], m.index, 10);
  }
  const im = intent.exec(desc);
  if (im && hasLoan && hasIntent && !isAccessory)
    add('intent', 'serviceIntent', 'description', im[0], im.index, 20);
  const annualMaximumInterests: number[] = [];
  const descriptionClauses = clauses(desc);
  for (const c of descriptionClauses) {
    const text = c.text;
    for (const m of text.matchAll(/\d+(?:[.,]\d+)?\s*[%％]/gu)) {
      // Bind a percentage to its own label, never to an earlier percentage's label.
      const previousPercent = Math.max(
        text.lastIndexOf('%', m.index! - 1),
        text.lastIndexOf('％', m.index! - 1),
      );
      const from = Math.max(0, m.index! - 90, previousPercent + 1);
      const tail = text
        .slice(m.index! + m[0].length, m.index! + m[0].length + 30)
        .split(/[,;\d]|\b(?:and|y|dan)\b|และ|اور/iu)[0];
      const context = text.slice(from, m.index! + m[0].length) + tail;
      const prefix = text.slice(from, m.index!);
      // Prefer a preceding label. A later APR label must not rename an earlier interest value.
      const binding = rateContext.test(prefix) ? prefix : tail;
      const lastLabel = (pattern: RegExp) =>
        [...prefix.matchAll(new RegExp(pattern.source, 'giu'))].at(-1)?.index ?? -1;
      const feeBound = lastLabel(fee) > lastLabel(rateContext);
      const value = Number(m[0].replace(/[%％\s]/g, '').replace(',', '.'));
      if (
        !feeBound &&
        rateContext.test(binding) &&
        !/deposit|savings|\bAPY\b|ahorro|tabungan/iu.test(context)
      ) {
        const isApr = apr.test(binding),
          isInterest = interest.test(binding),
          isMax = max.test(prefix);
        const field =
          isApr && isMax ? 'maximumApr' : isInterest && isMax ? 'maximumInterestRate' : 'rate';
        const rateType = isApr
          ? 'apr'
          : /\b(?:CAT|CFT|TNA|TEA)\b/u.test(binding)
            ? 'local-cost-rate'
            : 'interest';
        const periodText =
          /daily|per day|monthly|per month|annual|year|ต่อปี|รายวัน|ต่อวัน|tahun|سالانہ/iu.test(
            tail,
          )
            ? tail
            : prefix;
        const unit =
          isApr || annual.test(periodText)
            ? '%/year'
            : /daily|per day|รายวัน|ต่อวัน/iu.test(periodText)
              ? '%/day'
              : /monthly|per month/iu.test(periodText)
                ? '%/month'
                : '% (period not established)';
        add('financial', field, 'description', context, c.start + from, 15, {
          numericValue: value,
          rateType,
          unit,
        });
        families.add('rate');
        if (field === 'maximumInterestRate' && unit === '%/year')
          annualMaximumInterests.push(value);
      }
    }
    const times = [...text.matchAll(units)];
    if (
      times.length &&
      !/approval|approved|disburs|processing time|aprobaci[oó]n|persetujuan|อนุมัติ/iu.test(text) &&
      (term.test(text) ||
        (max.test(text) &&
          /^[\s]*(?:max|m[aá]xim|สูงสุด|زیادہ)/iu.test(text) &&
          /[;\n]\s*$/u.test(desc.slice(0, c.start)) &&
          term.test(desc.slice(Math.max(0, c.start - 100), c.start))))
    ) {
      const isRange = /\d+\s*(?:to|a|hasta|hingga|hanggang|ถึง|[-–])\s*\d+/iu.test(text);
      const hasMin = /min(?:imum|im[ao])|m[ií]nim[ao]|ขั้นต่ำ|کم از کم/iu.test(text) || isRange;
      const hasMax = max.test(text) || isRange;
      add(
        'financial',
        hasMin ? 'minRepaymentTerm' : 'repaymentTerm',
        'description',
        text,
        c.start,
        15,
      );
      if (hasMax) {
        observed.add('maxRepaymentTerm');
        if (!hasMin) evidence[evidence.length - 1].field = 'maxRepaymentTerm';
      }
      families.add('term');
    }
    if (
      fee.test(text) &&
      (numeric.test(text) ||
        /no fees?|zero fees?|sin comisi[oó]n|tanpa biaya|ไม่มีค่าธรรมเนียม/iu.test(text))
    ) {
      add('financial', 'fees', 'description', text, c.start, 15);
      families.add('fee');
    }
    if (
      /example|ejemplo|contoh|halimbawa|ตัวอย่าง|مثال/iu.test(text) &&
      [...text.matchAll(/\d+/gu)].length >= 3 &&
      /total|repay|pago|ชำระ|واپسی/iu.test(text)
    ) {
      add('financial', 'representativeExample', 'description', text, c.start, 15);
      families.add('example');
    }
  }
  const fieldPatterns: [string, RegExp][] = [
    [
      'privacyPolicy',
      /(?:privacy policy|pol[ií]tica de privacidad|kebijakan privasi|นโยบายความเป็นส่วนตัว)[^\n]{0,150}/iu,
    ],
    [
      'secRegistration',
      /SEC\s*(?:registration|reg(?:istration)?\.?\s*(?:no|number)?)[^\n;.]{0,80}/iu,
    ],
    [
      'certificateOfAuthority',
      /(?:certificate of authority|\bCA\s*(?:no\.?|number))[^\n;.]{0,80}/iu,
    ],
    ['unregulatedStatement', /This is a non-regulated loan provider under the BoT\/FPO/iu],
    ['ojkLicense', /(?:OJK|Otoritas Jasa Keuangan)[^\n;.]{0,90}/iu],
    ['secpApproval', /(?:SECP|Securities and Exchange Commission of Pakistan)[^\n;.]{0,90}/iu],
  ];
  for (const [field, pattern] of fieldPatterns) {
    const m = pattern.exec(desc);
    if (m) add('disclosure', field, 'description', m[0], m.index);
  }
  const entityPatterns: [LoanAnalysis['entities'][number]['role'], RegExp][] = [
    [
      'loanProvider',
      /(?:loan provider|lending (?:company|entity)|prestamista|proveedor del pr[eé]stamo|penyedia pinjaman|ผู้ให้บริการสินเชื่อ)\s*[:：]\s*([^\n;.۔]{2,160})/giu,
    ],
    [
      'developerLegalEntity',
      /(?:developer(?: legal entity| legal name| name)?|desarrollador|pengembang|ผู้พัฒนา(?:แอปพลิเคชัน)?)\s*[:：]\s*([^\n;.۔]{2,160})/giu,
    ],
    [
      'corporateName',
      /(?:corporate name|company name|raz[oó]n social|nama perusahaan|ชื่อบริษัท)\s*[:：]\s*([^\n;.۔]{2,160})/giu,
    ],
    [
      'businessName',
      /(?:business name|trade name|nombre comercial)\s*[:：]\s*([^\n;.۔]{2,160})/giu,
    ],
  ];
  for (const [role, pattern] of entityPatterns)
    for (const m of desc.slice(0, 100_000).matchAll(pattern)) {
      const e = add('entity', role, 'description', m[0], m.index!);
      entities.push({
        role,
        name: m[1].trim(),
        source: 'description',
        evidenceId: e.id,
        verified: false,
      });
    }
  for (const field of ['ojkLicense', 'secpApproval']) {
    const e = evidence.find((e) => e.field === field);
    if (e)
      entities.push({
        role: 'regulatorClaim',
        name: e.text,
        source: 'description',
        evidenceId: e.id,
        verified: false,
      });
  }
  const strong = hasLoan && hasIntent && !isAccessory && families.size >= 2;
  const verdict = strong ? 'strong' : hasLoan && !isAccessory ? 'possible' : 'insufficient';
  const personalScope = productType === 'personal-loan-or-facilitator';
  const annualMaximumInterest = annualMaximumInterests.length
    ? Math.max(...annualMaximumInterests)
    : undefined;
  const disclosures: LoanAnalysis['disclosures'] = catalog.rules
    .filter((rule) => rule.kind === 'disclosure' || rule.kind === 'context')
    .filter(
      (rule) =>
        rule.countries.includes('*') || rule.countries.includes(input.country.toLowerCase()),
    )
    .map((rule) => {
      const fields = rule.fields as string[],
        observedFields = fields.filter((f) => observed.has(f));
      const productApplies = rule.id.startsWith('GP-EWA-')
        ? productType === 'earned-wage-access'
        : rule.id.startsWith('GP-GEN-') || rule.id === 'GP-FIN-CATEGORY'
          ? productType !== 'unknown'
          : personalScope;
      const applies = rule.stores.includes(input.store) && productApplies;
      let status: LoanAnalysis['disclosures'][number]['status'] = !applies
        ? 'not_applicable'
        : rule.kind === 'context'
          ? 'conditional'
          : fields.every((f) => observed.has(f))
            ? 'observed'
            : 'not_observed';
      if (applies && rule.id === 'GP-TH-UNREGULATED')
        status =
          annualMaximumInterest === undefined
            ? 'conditional'
            : annualMaximumInterest >= 15
              ? 'not_applicable'
              : fields.every((f) => observed.has(f))
                ? 'observed'
                : 'not_observed';
      return {
        ruleId: rule.id,
        title: rule.title,
        sourceUrl: rule.sourceUrl,
        scope: `${rule.stores.join(', ')} · ${rule.countries.join(', ')}`,
        status,
        fields,
        observedFields,
        missingFields: fields.filter((f) => !observed.has(f)),
        note: !rule.stores.includes(input.store)
          ? 'Google Play 政策不作为 App Store 披露义务。'
          : !productApplies
            ? '当前识别的产品类型不属于本条适用范围；可结合原文人工核对。'
            : `${rule.summary}${rule.condition ? ` 条件：${rule.condition}` : ''} 文本命中不代表披露完整或已验证合规。`,
      };
    });
  return {
    classification: strong ? 'confirmed' : 'candidate',
    verdict,
    confidence: strong ? Math.min(95, 60 + families.size * 8) : hasLoan ? (hasIntent ? 45 : 25) : 0,
    ruleVersion: `${catalog.version}/heuristics-2`,
    analyzedAt: new Date().toISOString(),
    sourceObservedAt: input.observedAt || null,
    summary: strong
      ? `发现信贷服务意图及 ${families.size} 类独立数值披露，支持信贷应用识别。`
      : isAccessory
        ? '描述主要为计算器或指南；保持待确认。'
        : hasLoan
          ? '存在信贷相关文本，服务或数值披露证据不足。'
          : '当前文本缺少可用信贷证据。',
    productType,
    evidence,
    disclosures,
    entities,
    store: input.store,
    country: input.country,
    policyRetrievedAt: catalog.retrievedAt,
    countryPolicyNote:
      catalog.countries.find((c) => c.code === input.country.toLowerCase())?.note ||
      '当前国家尚未核对本地法律要求；通用规则仅作识别线索。',
    limitations: [
      '证据分为启发式匹配分数，不是统计概率。识别不等同牌照、主体或合规认证。',
      '仅分析已采集文本；未命中不等于未披露，存在语言、格式和动态页面遗漏。',
      '普通利率、APR 和 CAT/CFT 等成本指标分别保留，不相互替代。',
      '商店显示的公司信息及描述中的监管声明未经独立注册或牌照核验。',
    ],
    sources: catalog.sources
      .filter((s) => s.id === 'google-play-financial' || s.id === 'appeye-method')
      .map((s) => ({ title: s.title, url: s.url })),
  };
}
