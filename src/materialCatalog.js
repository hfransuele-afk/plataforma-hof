/**
 * Catálogo Oficial de Insumos, Materiais e Tecnologias
 * Dra. Fransuele Hanel • Biomedicina Estética Avançada
 */

const defaultMaterials = [
  // ─── Tecnologias de Ponta ──────────────────────────────────
  {
    category: 'Tecnologia',
    name: 'LAVIEEN (Sessão Custo Fixo)',
    unit_type: 'Sessão',
    cost_per_unit: 200.00,
    quick_step: 1
  },
  {
    category: 'Tecnologia',
    name: 'ELLEVA SMART (Ultrassom Microfocado)',
    unit_type: 'Disparo',
    cost_per_unit: 1.60,
    quick_step: 50
  },

  // ─── Toxina Botulínica (por Unidade U) ─────────────────────
  {
    category: 'Toxina Botulínica',
    name: 'Toxina XEOMIN',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.50,
    quick_step: 10
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Letybo',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.00,
    quick_step: 10
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Botulift',
    unit_type: 'Unidade (U)',
    cost_per_unit: 6.00,
    quick_step: 10
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Botulim',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.25,
    quick_step: 10
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Nabota',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.00,
    quick_step: 10
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Dysport',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.00,
    quick_step: 10
  },

  // ─── Preenchedores com Ácido Hialurônico ────────────────────
  {
    category: 'Preenchedor',
    name: 'Preenchedor Facial (Deepline, Lips, Lift, Lift-Plus)',
    unit_type: 'mL / Seringa',
    cost_per_unit: 220.00,
    quick_step: 1
  },
  {
    category: 'Preenchedor',
    name: 'Preenchedor Belotero',
    unit_type: 'mL / Seringa',
    cost_per_unit: 250.00,
    quick_step: 1
  },
  {
    category: 'Preenchedor',
    name: 'Preenchedor Ultra-Volume (2mL)',
    unit_type: '2mL',
    cost_per_unit: 440.00,
    quick_step: 1
  },
  {
    category: 'Preenchedor',
    name: 'Preenchedor Fill Hyaluronic Corporal',
    unit_type: 'Frasco',
    cost_per_unit: 350.00,
    quick_step: 1
  },
  {
    category: 'Preenchedor',
    name: 'Preenchedor Corporal Sofiderm (20mL)',
    unit_type: '20mL',
    cost_per_unit: 2400.00,
    quick_step: 1
  },
  {
    category: 'Preenchedor',
    name: 'Preenchedor Corporal Estrianon (9mL puro)',
    unit_type: '9mL',
    cost_per_unit: 920.00,
    quick_step: 1
  },

  // ─── Bioestimuladores de Colágeno ─────────────────────────
  {
    category: 'Bioestimulador',
    name: 'Elleva 150mg (PLLA)',
    unit_type: 'Frasco',
    cost_per_unit: 550.00,
    quick_step: 1
  },
  {
    category: 'Bioestimulador',
    name: 'Elleva 210mg (PLLA)',
    unit_type: 'Frasco',
    cost_per_unit: 750.00,
    quick_step: 1
  },
  {
    category: 'Bioestimulador',
    name: 'Elleva X',
    unit_type: 'Frasco',
    cost_per_unit: 2000.00,
    quick_step: 1
  },
  {
    category: 'Bioestimulador',
    name: 'Radiesse 1,5 (CaHA)',
    unit_type: 'Seringa 1,5mL',
    cost_per_unit: 700.00,
    quick_step: 1
  },
  {
    category: 'Bioestimulador',
    name: 'Radiesse 3,0 (CaHA)',
    unit_type: 'Seringa 3,0mL',
    cost_per_unit: 1300.00,
    quick_step: 1
  },
  {
    category: 'Bioestimulador',
    name: 'Diamond (Bioestimulador)',
    unit_type: 'Frasco',
    cost_per_unit: 550.00,
    quick_step: 1
  },

  // ─── Fios de PDO ──────────────────────────────────────────
  {
    category: 'Fios PDO',
    name: 'Fios PDO Liso (Mono)',
    unit_type: 'Fio',
    cost_per_unit: 20.00,
    quick_step: 5
  },
  {
    category: 'Fios PDO',
    name: 'Fios PDO Screw',
    unit_type: 'Fio',
    cost_per_unit: 30.00,
    quick_step: 5
  },
  {
    category: 'Fios PDO',
    name: 'Fios PDO Cutting',
    unit_type: 'Fio',
    cost_per_unit: 60.00,
    quick_step: 2
  },
  {
    category: 'Fios PDO',
    name: 'Fios PDO Molding',
    unit_type: 'Fio',
    cost_per_unit: 150.00,
    quick_step: 2
  },

  // ─── Cânulas e Insumos Cirúrgicos / Clínicos ──────────────
  {
    category: 'Cânulas e Insumos',
    name: 'Cânula Rennova',
    unit_type: 'Unidade',
    cost_per_unit: 12.00,
    quick_step: 1
  },
  {
    category: 'Cânulas e Insumos',
    name: 'Cânula Alur',
    unit_type: 'Unidade',
    cost_per_unit: 15.00,
    quick_step: 1
  },
  {
    category: 'Cânulas e Insumos',
    name: 'Cartucho Microagulhamento',
    unit_type: 'Unidade',
    cost_per_unit: 12.00,
    quick_step: 1
  },
  {
    category: 'Cânulas e Insumos',
    name: 'Hialuronidase 3.000 UTR',
    unit_type: 'Frasco',
    cost_per_unit: 60.00,
    quick_step: 1
  },
  {
    category: 'Cânulas e Insumos',
    name: 'Anestésico Lidocaína 20mL (c/s vaso)',
    unit_type: 'Frasco 20mL',
    cost_per_unit: 20.00,
    quick_step: 1
  },

  // ─── Procedimentos / Sessões Associadas ───────────────────
  {
    category: 'Procedimento / Sessão',
    name: 'Sedação Clínica',
    unit_type: 'Sessão',
    cost_per_unit: 200.00,
    quick_step: 1
  },
  {
    category: 'Procedimento / Sessão',
    name: 'Carboxiterapia',
    unit_type: 'Sessão',
    cost_per_unit: 0.00,
    quick_step: 1
  }
];

const defaultCardRates = [
  { method_code: 'pix', label: 'Pix à Vista', installments: 1, fee_pct: 0.0 },
  { method_code: 'dinheiro', label: 'Dinheiro à Vista', installments: 1, fee_pct: 0.0 },
  { method_code: 'debito', label: 'Cartão de Débito', installments: 1, fee_pct: 1.35 },
  { method_code: 'credito_1x', label: 'Crédito 1x (à vista)', installments: 1, fee_pct: 3.15 },
  { method_code: 'credito_2x', label: 'Crédito 2x', installments: 2, fee_pct: 4.40 },
  { method_code: 'credito_3x', label: 'Crédito 3x', installments: 3, fee_pct: 5.20 },
  { method_code: 'credito_4x', label: 'Crédito 4x', installments: 4, fee_pct: 6.00 },
  { method_code: 'credito_5x', label: 'Crédito 5x', installments: 5, fee_pct: 6.80 },
  { method_code: 'credito_6x', label: 'Crédito 6x', installments: 6, fee_pct: 7.60 },
  { method_code: 'credito_7x', label: 'Crédito 7x', installments: 7, fee_pct: 8.40 },
  { method_code: 'credito_8x', label: 'Crédito 8x', installments: 8, fee_pct: 9.10 },
  { method_code: 'credito_9x', label: 'Crédito 9x', installments: 9, fee_pct: 9.80 },
  { method_code: 'credito_10x', label: 'Crédito 10x', installments: 10, fee_pct: 10.50 },
  { method_code: 'credito_11x', label: 'Crédito 11x', installments: 11, fee_pct: 11.20 },
  { method_code: 'credito_12x', label: 'Crédito 12x', installments: 12, fee_pct: 11.90 }
];

module.exports = {
  defaultMaterials,
  defaultCardRates
};
