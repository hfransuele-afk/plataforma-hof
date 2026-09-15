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
    quick_step: 1
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Letybo',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.00,
    quick_step: 1
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Botulift',
    unit_type: 'Unidade (U)',
    cost_per_unit: 6.00,
    quick_step: 1
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Botulim',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.25,
    quick_step: 1
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Nabota',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.00,
    quick_step: 1
  },
  {
    category: 'Toxina Botulínica',
    name: 'Toxina Dysport',
    unit_type: 'Unidade (U)',
    cost_per_unit: 5.00,
    quick_step: 1
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
  // ─── Pagamentos à Vista Sem Taxa ─────────────────────────
  { method_code: 'pix', label: 'Pix à Vista', brand: 'geral', installments: 1, fee_pct: 0.0 },
  { method_code: 'dinheiro', label: 'Dinheiro à Vista', brand: 'geral', installments: 1, fee_pct: 0.0 },

  // ─── Coluna 1: Mastercard / VISA (Ton Black) ─────────────
  { method_code: 'vm_debito', label: 'Débito Visa / Master', brand: 'visa_master', installments: 1, fee_pct: 0.84 },
  { method_code: 'vm_credito_1x', label: 'Crédito 1x (à vista) Visa / Master', brand: 'visa_master', installments: 1, fee_pct: 2.88 },
  { method_code: 'vm_credito_2x', label: 'Crédito 2x Visa / Master', brand: 'visa_master', installments: 2, fee_pct: 4.21 },
  { method_code: 'vm_credito_3x', label: 'Crédito 3x Visa / Master', brand: 'visa_master', installments: 3, fee_pct: 4.82 },
  { method_code: 'vm_credito_4x', label: 'Crédito 4x Visa / Master', brand: 'visa_master', installments: 4, fee_pct: 5.43 },
  { method_code: 'vm_credito_5x', label: 'Crédito 5x Visa / Master', brand: 'visa_master', installments: 5, fee_pct: 6.04 },
  { method_code: 'vm_credito_6x', label: 'Crédito 6x Visa / Master', brand: 'visa_master', installments: 6, fee_pct: 6.63 },
  { method_code: 'vm_credito_7x', label: 'Crédito 7x Visa / Master', brand: 'visa_master', installments: 7, fee_pct: 7.23 },
  { method_code: 'vm_credito_8x', label: 'Crédito 8x Visa / Master', brand: 'visa_master', installments: 8, fee_pct: 7.81 },
  { method_code: 'vm_credito_9x', label: 'Crédito 9x Visa / Master', brand: 'visa_master', installments: 9, fee_pct: 8.40 },
  { method_code: 'vm_credito_10x', label: 'Crédito 10x Visa / Master', brand: 'visa_master', installments: 10, fee_pct: 8.97 },
  { method_code: 'vm_credito_11x', label: 'Crédito 11x Visa / Master', brand: 'visa_master', installments: 11, fee_pct: 9.55 },
  { method_code: 'vm_credito_12x', label: 'Crédito 12x Visa / Master', brand: 'visa_master', installments: 12, fee_pct: 10.11 },
  { method_code: 'vm_credito_13x', label: 'Crédito 13x Visa / Master', brand: 'visa_master', installments: 13, fee_pct: 13.11 },
  { method_code: 'vm_credito_14x', label: 'Crédito 14x Visa / Master', brand: 'visa_master', installments: 14, fee_pct: 13.63 },
  { method_code: 'vm_credito_15x', label: 'Crédito 15x Visa / Master', brand: 'visa_master', installments: 15, fee_pct: 14.18 },
  { method_code: 'vm_credito_16x', label: 'Crédito 16x Visa / Master', brand: 'visa_master', installments: 16, fee_pct: 14.75 },
  { method_code: 'vm_credito_17x', label: 'Crédito 17x Visa / Master', brand: 'visa_master', installments: 17, fee_pct: 15.34 },
  { method_code: 'vm_credito_18x', label: 'Crédito 18x Visa / Master', brand: 'visa_master', installments: 18, fee_pct: 15.95 },
  { method_code: 'vm_credito_19x', label: 'Crédito 19x Visa / Master', brand: 'visa_master', installments: 19, fee_pct: 16.59 },
  { method_code: 'vm_credito_20x', label: 'Crédito 20x Visa / Master', brand: 'visa_master', installments: 20, fee_pct: 17.23 },
  { method_code: 'vm_credito_21x', label: 'Crédito 21x Visa / Master', brand: 'visa_master', installments: 21, fee_pct: 17.87 },

  // ─── Coluna 2: Elo / American Express (Ton Black) ─────────
  { method_code: 'elo_debito', label: 'Débito Elo / Amex', brand: 'elo_amex', installments: 1, fee_pct: 2.07 },
  { method_code: 'elo_credito_1x', label: 'Crédito 1x (à vista) Elo / Amex', brand: 'elo_amex', installments: 1, fee_pct: 4.64 },
  { method_code: 'elo_credito_2x', label: 'Crédito 2x Elo / Amex', brand: 'elo_amex', installments: 2, fee_pct: 6.08 },
  { method_code: 'elo_credito_3x', label: 'Crédito 3x Elo / Amex', brand: 'elo_amex', installments: 3, fee_pct: 6.68 },
  { method_code: 'elo_credito_4x', label: 'Crédito 4x Elo / Amex', brand: 'elo_amex', installments: 4, fee_pct: 7.27 },
  { method_code: 'elo_credito_5x', label: 'Crédito 5x Elo / Amex', brand: 'elo_amex', installments: 5, fee_pct: 7.86 },
  { method_code: 'elo_credito_6x', label: 'Crédito 6x Elo / Amex', brand: 'elo_amex', installments: 6, fee_pct: 8.45 },
  { method_code: 'elo_credito_7x', label: 'Crédito 7x Elo / Amex', brand: 'elo_amex', installments: 7, fee_pct: 9.04 },
  { method_code: 'elo_credito_8x', label: 'Crédito 8x Elo / Amex', brand: 'elo_amex', installments: 8, fee_pct: 9.62 },
  { method_code: 'elo_credito_9x', label: 'Crédito 9x Elo / Amex', brand: 'elo_amex', installments: 9, fee_pct: 10.19 },
  { method_code: 'elo_credito_10x', label: 'Crédito 10x Elo / Amex', brand: 'elo_amex', installments: 10, fee_pct: 10.75 },
  { method_code: 'elo_credito_11x', label: 'Crédito 11x Elo / Amex', brand: 'elo_amex', installments: 11, fee_pct: 11.32 },
  { method_code: 'elo_credito_12x', label: 'Crédito 12x Elo / Amex', brand: 'elo_amex', installments: 12, fee_pct: 11.87 },
  { method_code: 'elo_credito_13x', label: 'Crédito 13x Elo / Amex', brand: 'elo_amex', installments: 13, fee_pct: 14.87 },
  { method_code: 'elo_credito_14x', label: 'Crédito 14x Elo / Amex', brand: 'elo_amex', installments: 14, fee_pct: 15.46 },
  { method_code: 'elo_credito_15x', label: 'Crédito 15x Elo / Amex', brand: 'elo_amex', installments: 15, fee_pct: 16.08 },
  { method_code: 'elo_credito_16x', label: 'Crédito 16x Elo / Amex', brand: 'elo_amex', installments: 16, fee_pct: 16.73 },
  { method_code: 'elo_credito_17x', label: 'Crédito 17x Elo / Amex', brand: 'elo_amex', installments: 17, fee_pct: 17.40 },
  { method_code: 'elo_credito_18x', label: 'Crédito 18x Elo / Amex', brand: 'elo_amex', installments: 18, fee_pct: 18.09 },
  { method_code: 'elo_credito_19x', label: 'Crédito 19x Elo / Amex', brand: 'elo_amex', installments: 19, fee_pct: 18.73 },
  { method_code: 'elo_credito_20x', label: 'Crédito 20x Elo / Amex', brand: 'elo_amex', installments: 20, fee_pct: 19.37 },
  { method_code: 'elo_credito_21x', label: 'Crédito 21x Elo / Amex', brand: 'elo_amex', installments: 21, fee_pct: 20.01 }
];

module.exports = {
  defaultMaterials,
  defaultCardRates
};
