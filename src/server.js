const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { formSections, fieldLabels } = require('./formSchema');
const { consentTemplates } = require('./consentTemplates');
const { defaultMaterials, defaultCardRates } = require('./materialCatalog');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const storageDir = path.join(__dirname, '..', 'storage');
const uploadDir = path.join(storageDir, 'uploads');
const dbPath = path.join(storageDir, 'clinic.db');

if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

setupDatabase();
seedDefaultAdmin();
backfillLegacyPatients();
ensureAppointmentPatientNullable();
ensureAppointmentValueColumn();
ensurePatientNotesColumn();
ensureSubmissionSignatureColumn();
ensureNewClinicalAndFinancialTables();
migratePatientNotesToEvolutions();

app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '2mb' }));
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ext.match(/^\.[a-z0-9]+$/i) ? ext : '.jpg';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
    }
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB por foto/arquivo
    files: 50
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isImageMime = file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype === 'application/octet-stream');
    const isPdfMime = file.mimetype === 'application/pdf';
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp', '.tiff', '.avif'];
    const isImageExt = imageExtensions.includes(ext);
    const isPdfExt = ext === '.pdf';

    if (isImageMime || isPdfMime || isImageExt || isPdfExt) {
      cb(null, true);
      return;
    }
    cb(new Error('Formato de arquivo não suportado. Envie imagens (JPG, PNG, HEIC, WebP, etc.) ou PDF.'));
  }
});

const uploadPatientFiles = upload.fields([
  { name: 'facePhotos', maxCount: 20 },
  { name: 'productPhotos', maxCount: 30 },
  { name: 'examFiles', maxCount: 15 }
]);

function setupDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patient_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      patient_id INTEGER,
      patient_name_hint TEXT,
      patient_email_hint TEXT,
      is_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER,
      link_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id),
      FOREIGN KEY(link_id) REFERENCES patient_links(id)
    );

    CREATE TABLE IF NOT EXISTS submission_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      patient_id INTEGER,
      submission_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id),
      FOREIGN KEY(patient_id) REFERENCES patients(id),
      FOREIGN KEY(submission_id) REFERENCES submissions(id)
    );

    CREATE TABLE IF NOT EXISTS ai_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      ordem INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn('patient_links', 'patient_id', 'patient_id INTEGER REFERENCES patients(id)');
  ensureColumn('submissions', 'patient_id', 'patient_id INTEGER REFERENCES patients(id)');
  ensureColumn('chat_messages', 'patient_id', 'patient_id INTEGER REFERENCES patients(id)');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_code ON patients(patient_code);
    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
    CREATE INDEX IF NOT EXISTS idx_submissions_patient ON submissions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_links_patient ON patient_links(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
  `);
}

function ensureColumn(tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

function ensureAppointmentPatientNullable() {
  const tableInfo = db.prepare('PRAGMA table_info(appointments)').all();
  const col = tableInfo.find((c) => c.name === 'patient_id');
  if (!col || col.notnull === 0) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE appointments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    INSERT INTO appointments_new
      SELECT id, patient_id, title, start_at, end_at, notes, status, created_at
      FROM appointments;

    DROP TABLE appointments;

    ALTER TABLE appointments_new RENAME TO appointments;

    PRAGMA foreign_keys = ON;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
  `);
}

function ensureAppointmentValueColumn() {
  const cols = db.prepare('PRAGMA table_info(appointments)').all();
  if (!cols.some((c) => c.name === 'value')) {
    db.exec('ALTER TABLE appointments ADD COLUMN value REAL');
  }
}

function ensurePatientNotesColumn() {
  const cols = db.prepare('PRAGMA table_info(patients)').all();
  if (!cols.some((c) => c.name === 'notes')) {
    db.exec('ALTER TABLE patients ADD COLUMN notes TEXT');
  }
}

function ensureSubmissionSignatureColumn() {
  const cols = db.prepare('PRAGMA table_info(submissions)').all();
  if (!cols.some((c) => c.name === 'signature_data')) {
    db.exec('ALTER TABLE submissions ADD COLUMN signature_data TEXT');
  }
}

function ensureNewClinicalAndFinancialTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_evolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      procedure_name TEXT,
      session_date TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS patient_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS consent_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      procedure_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patient_consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      template_id INTEGER,
      token TEXT NOT NULL UNIQUE,
      procedure_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      signature_data TEXT,
      signed_name TEXT,
      signed_at TEXT,
      client_ip TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id),
      FOREIGN KEY(template_id) REFERENCES consent_templates(id)
    );

    CREATE TABLE IF NOT EXISTS material_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      cost_per_unit REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      default_tax_pct REAL DEFAULT 6.0,
      default_card_fee_pct REAL DEFAULT 3.5,
      default_clinic_split_pct REAL DEFAULT 30.0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS procedure_financials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER,
      appointment_id INTEGER,
      evolution_id INTEGER,
      description TEXT NOT NULL,
      gross_value REAL NOT NULL,
      materials_cost REAL DEFAULT 0,
      materials_json TEXT,
      tax_pct REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      card_fee_pct REAL DEFAULT 0,
      card_fee_amount REAL DEFAULT 0,
      clinic_split_pct REAL DEFAULT 0,
      clinic_split_amount REAL DEFAULT 0,
      net_profit REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );

    CREATE INDEX IF NOT EXISTS idx_evolutions_patient ON patient_evolutions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_media_patient ON patient_media(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consents_patient ON patient_consents(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consents_token ON patient_consents(token);
    CREATE INDEX IF NOT EXISTS idx_financials_patient ON procedure_financials(patient_id);
  `);

  if (consentTemplates && consentTemplates.length) {
    const upsertTpl = db.prepare(`
      INSERT INTO consent_templates (slug, title, procedure_name, content, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        procedure_name = excluded.procedure_name,
        content = excluded.content
    `);
    for (const tpl of consentTemplates) {
      upsertTpl.run(tpl.slug, tpl.title, tpl.procedure_name, tpl.content, nowIso());
    }
  }

  // Ensure schema updates for material_costs
  const mcCols = db.pragma('table_info(material_costs)');
  if (!mcCols.some((c) => c.name === 'category')) {
    db.exec("ALTER TABLE material_costs ADD COLUMN category TEXT DEFAULT 'Geral'");
  }
  if (!mcCols.some((c) => c.name === 'quick_step')) {
    db.exec("ALTER TABLE material_costs ADD COLUMN quick_step REAL DEFAULT 1");
  }

  // Ensure card_fee_rates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_fee_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method_code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT 'geral',
      installments INTEGER NOT NULL DEFAULT 1,
      fee_pct REAL NOT NULL DEFAULT 0.0,
      updated_at TEXT NOT NULL
    );
  `);

  const cfrCols = db.pragma('table_info(card_fee_rates)');
  if (!cfrCols.some((c) => c.name === 'brand')) {
    db.exec("ALTER TABLE card_fee_rates ADD COLUMN brand TEXT DEFAULT 'geral'");
  }

  if (defaultCardRates && defaultCardRates.length) {
    const upsertCardRate = db.prepare(`
      INSERT INTO card_fee_rates (method_code, label, brand, installments, fee_pct, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(method_code) DO UPDATE SET
        label = excluded.label,
        brand = excluded.brand,
        installments = excluded.installments,
        fee_pct = excluded.fee_pct,
        updated_at = excluded.updated_at
    `);
    for (const r of defaultCardRates) {
      upsertCardRate.run(r.method_code, r.label, r.brand || 'geral', r.installments, r.fee_pct, nowIso());
    }
  }

  // Remove códigos legados obsoletos anteriores à diferenciação Ton Black
  db.exec("DELETE FROM card_fee_rates WHERE method_code IN ('debito', 'credito_1x', 'credito_2x', 'credito_3x', 'credito_4x', 'credito_5x', 'credito_6x', 'credito_7x', 'credito_8x', 'credito_9x', 'credito_10x', 'credito_11x', 'credito_12x')");

  // Atualiza quick_step = 1 para todas as marcas de Toxina Botulínica
  db.prepare("UPDATE material_costs SET quick_step = 1 WHERE category = 'Toxina Botulínica'").run();

  // Ensure procedure_financials extra columns
  const pfCols = db.pragma('table_info(procedure_financials)');
  if (!pfCols.some((c) => c.name === 'payment_method')) {
    db.exec("ALTER TABLE procedure_financials ADD COLUMN payment_method TEXT DEFAULT 'pix'");
  }
  if (!pfCols.some((c) => c.name === 'installments')) {
    db.exec("ALTER TABLE procedure_financials ADD COLUMN installments INTEGER DEFAULT 1");
  }
  if (!pfCols.some((c) => c.name === 'value_after_card')) {
    db.exec("ALTER TABLE procedure_financials ADD COLUMN value_after_card REAL DEFAULT 0");
  }
  if (!pfCols.some((c) => c.name === 'value_after_tax')) {
    db.exec("ALTER TABLE procedure_financials ADD COLUMN value_after_tax REAL DEFAULT 0");
  }
  if (!pfCols.some((c) => c.name === 'professional_subtotal')) {
    db.exec("ALTER TABLE procedure_financials ADD COLUMN professional_subtotal REAL DEFAULT 0");
  }

  // Seed / Update official clinic materials from materialCatalog
  if (defaultMaterials && defaultMaterials.length) {
    const checkMat = db.prepare('SELECT id FROM material_costs WHERE name = ?');
    const updateMat = db.prepare(`
      UPDATE material_costs 
      SET category = ?, unit_type = ?, cost_per_unit = ?, quick_step = ?, is_active = 1
      WHERE id = ?
    `);
    const insertMat = db.prepare(`
      INSERT INTO material_costs (name, category, unit_type, cost_per_unit, quick_step, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);

    const officialNames = defaultMaterials.map((m) => m.name);
    for (const m of defaultMaterials) {
      const existing = checkMat.get(m.name);
      if (existing) {
        updateMat.run(m.category, m.unit_type, m.cost_per_unit, m.quick_step || 1, existing.id);
      } else {
        insertMat.run(m.name, m.category, m.unit_type, m.cost_per_unit, m.quick_step || 1, nowIso());
      }
    }

    // Inactivate legacy non-matching materials
    const currentRows = db.prepare('SELECT id, name FROM material_costs').all();
    for (const cur of currentRows) {
      if (!officialNames.includes(cur.name)) {
        db.prepare('UPDATE material_costs SET is_active = 0 WHERE id = ?').run(cur.id);
      }
    }
  }

  const countSettings = db.prepare('SELECT count(*) as c FROM clinic_settings').get().c;
  if (countSettings === 0) {
    db.prepare(
      'INSERT INTO clinic_settings (default_tax_pct, default_card_fee_pct, default_clinic_split_pct, updated_at) VALUES (?, ?, ?, ?)'
    ).run(6.0, 3.5, 30.0, nowIso());
  }
}

/**
 * Regra oficial de cálculo sequencial do Lucro Líquido (Dra. Fran Hanel)
 * 1. Valor total pago pela paciente
 * 2. (-) Taxa do cartão de acordo com o parcelamento
 * 3. (-) 6% de imposto sobre o valor após cartão
 * 4. (-) 30% da clínica sobre o valor após imposto
 * 5. (-) Custo dos materiais e tecnologias utilizados
 * 6. (=) Lucro Líquido final da Fran
 */
function calculateProcedureProfit({
  grossValue = 0,
  cardFeePct = 0,
  taxPct = 6.0,
  clinicSplitPct = 30.0,
  materialsCost = 0
}) {
  const gross = Math.max(0, parseFloat(grossValue) || 0);
  const cardPct = Math.max(0, parseFloat(cardFeePct) || 0);
  const taxP = Math.max(0, parseFloat(taxPct) || 0);
  const clinicP = Math.max(0, parseFloat(clinicSplitPct) || 0);
  const matCost = Math.max(0, parseFloat(materialsCost) || 0);

  // 1. Taxa do cartão sobre o valor total pago
  const cardFeeAmount = gross * (cardPct / 100);
  const valueAfterCard = gross - cardFeeAmount;

  // 2. Imposto de 6% sobre o valor após taxa do cartão
  const taxAmount = valueAfterCard * (taxP / 100);
  const valueAfterTax = valueAfterCard - taxAmount;

  // 3. Repasse da clínica (30%) sobre o valor após imposto
  const clinicSplitAmount = valueAfterTax * (clinicP / 100);
  const professionalSubtotal = valueAfterTax - clinicSplitAmount;

  // 4. Subtrair custo dos insumos e tecnologias utilizadas
  const netProfit = professionalSubtotal - matCost;

  return {
    grossValue: gross,
    cardFeePct: cardPct,
    cardFeeAmount,
    valueAfterCard,
    taxPct: taxP,
    taxAmount,
    valueAfterTax,
    clinicSplitPct: clinicP,
    clinicSplitAmount,
    professionalSubtotal,
    materialsCost: matCost,
    netProfit
  };
}

function renderMaterialsPickerHtml({ materials, prefix = 'mat', onchangeFn = 'recalcProfit' }) {
  const categoryOrder = [
    'Tecnologia',
    'Toxina Botulínica',
    'Preenchedor',
    'Bioestimulador',
    'Fios PDO',
    'Cânulas e Insumos',
    'Procedimento / Sessão'
  ];

  const grouped = {};
  for (const m of materials) {
    const cat = m.category || 'Geral';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }

  const sortedCats = Object.keys(grouped).sort((a, b) => {
    const ia = categoryOrder.indexOf(a);
    const ib = categoryOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  return sortedCats.map((cat) => {
    const items = grouped[cat];
    const itemsHtml = items.map((m) => {
      const step = m.quick_step || (m.unit_type === 'Disparo' ? 50 : 1);
      const isTech = cat === 'Tecnologia';
      return `
        <div class="material-item-row" id="${prefix}_row_${m.id}">
          <label class="material-item-name" style="cursor:pointer;margin:0">
            <input type="checkbox" class="${prefix}-mat-checkbox" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-cost="${m.cost_per_unit}" data-step="${step}" onchange="${prefix}OnCheckChange(${m.id}); ${onchangeFn}()">
            <div>
              <span>${escapeHtml(m.name)}</span>
              <div class="material-item-price">
                ${escapeHtml(m.unit_type)} · <strong>R$ ${escapeHtml(formatBRL(m.cost_per_unit))}</strong>
                ${isTech && m.unit_type === 'Disparo' ? '<span class="badge" style="background:#fef3c7;color:#92400e;margin-left:4px">Microfocado (R$ 1,60/disp)</span>' : ''}
                ${isTech && m.unit_type === 'Sessão' ? '<span class="badge" style="background:#e0f2fe;color:#0369a1;margin-left:4px">Laser Thulium (Fixo R$ 200)</span>' : ''}
              </div>
            </div>
          </label>
          <div class="material-qty-wrap">
            <button type="button" class="mat-qty-btn" onclick="${prefix}AdjustQty(${m.id}, -${step}); ${onchangeFn}()" title="Diminuir">-</button>
            <input type="number" min="0" step="any" value="0" class="${prefix}-mat-qty mat-qty-input" data-id="${m.id}" data-cost="${m.cost_per_unit}" data-step="${step}" oninput="${prefix}OnQtyInput(${m.id}); ${onchangeFn}()" title="Quantidade livre">
            <button type="button" class="mat-qty-btn" onclick="${prefix}AdjustQty(${m.id}, ${step}); ${onchangeFn}()" title="Aumentar">+</button>
          </div>
          <div class="material-item-total" id="${prefix}_total_${m.id}">
            R$ 0,00
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="materials-category-block" style="margin-bottom:12px">
        <div class="materials-category-header">
          <span>${escapeHtml(cat)}</span>
          <span style="font-size:0.75rem;font-weight:normal;opacity:0.8">${items.length} itens</span>
        </div>
        ${itemsHtml}
      </div>
    `;
  }).join('');
}

function renderMaterialsPickerScript(prefix, onchangeFn) {
  return `
    function ${prefix}AdjustQty(id, delta) {
      var input = document.querySelector('.${prefix}-mat-qty[data-id="' + id + '"]');
      if (!input) return;
      var cur = parseFloat(input.value) || 0;
      var next = Math.max(0, cur + delta);
      input.value = next;
      ${prefix}OnQtyInput(id);
      if (typeof ${onchangeFn} === 'function') ${onchangeFn}();
    }

    function ${prefix}OnQtyInput(id) {
      var input = document.querySelector('.${prefix}-mat-qty[data-id="' + id + '"]');
      var cb = document.querySelector('.${prefix}-mat-checkbox[data-id="' + id + '"]');
      var row = document.getElementById('${prefix}_row_' + id);
      var totalElem = document.getElementById('${prefix}_total_' + id);
      if (!input) return;
      var qty = parseFloat(input.value) || 0;
      var cost = parseFloat(input.dataset.cost) || 0;
      var total = qty * cost;
      if (totalElem) totalElem.textContent = 'R$ ' + (total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      if (qty > 0) {
        if (cb) cb.checked = true;
        if (row) row.classList.add('active');
      } else {
        if (cb) cb.checked = false;
        if (row) row.classList.remove('active');
      }
    }

    function ${prefix}OnCheckChange(id) {
      var cb = document.querySelector('.${prefix}-mat-checkbox[data-id="' + id + '"]');
      var input = document.querySelector('.${prefix}-mat-qty[data-id="' + id + '"]');
      if (!cb || !input) return;
      var step = parseFloat(input.dataset.step) || 1;
      if (cb.checked) {
        if ((parseFloat(input.value) || 0) <= 0) {
          input.value = step;
        }
      } else {
        input.value = 0;
      }
      ${prefix}OnQtyInput(id);
    }
  `;
}

function migratePatientNotesToEvolutions() {
  try {
    const patientsWithNotes = db.prepare("SELECT id, notes, updated_at, created_at FROM patients WHERE notes IS NOT NULL AND trim(notes) != ''").all();
    for (const p of patientsWithNotes) {
      const hasEvolutions = db.prepare('SELECT count(*) as c FROM patient_evolutions WHERE patient_id = ?').get(p.id).c;
      if (hasEvolutions === 0) {
        db.prepare(`
          INSERT INTO patient_evolutions (patient_id, procedure_name, session_date, notes, created_at, updated_at)
          VALUES (?, 'Observações Iniciais', ?, ?, ?, ?)
        `).run(p.id, p.created_at ? p.created_at.slice(0, 10) : nowIso().slice(0, 10), p.notes, p.created_at || nowIso(), p.updated_at || nowIso());
      }
    }
  } catch (err) {
    console.error('Erro ao migrar notas para evoluções:', err.message);
  }
}

function toWhatsAppLink(phone, message = '') {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  const fullNumber = digits.length <= 11 ? `55${digits}` : digits;
  const encodedMsg = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${fullNumber}${encodedMsg}`;
}

function seedDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS total FROM admins').get().total;
  if (count > 0) {
    return;
  }

  const email = process.env.ADMIN_EMAIL || 'admin@clinica.local';
  const password = process.env.ADMIN_PASSWORD || 'TroqueEssaSenha123!';
  const passwordHash = bcrypt.hashSync(password, 12);

  db.prepare(
    'INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)'
  ).run(email, passwordHash, nowIso());

  console.log('Administrador inicial criado.');
  console.log(`Email: ${email}`);
  console.log(`Senha: ${password}`);
}

function nowIso() {
  return new Date().toISOString();
}

function toCodeNumber(value) {
  return String(value).padStart(4, '0');
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('pt-BR');
  }

  return String(value);
}

function combineDateTime(datePart, timePart) {
  const d = String(datePart || '').trim();
  const t = String(timePart || '').trim();
  if (!d) return null;
  return `${d}T${t || '00:00'}:00`;
}

function formatTime(value) {
  if (!value) {
    return '--:--';
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  const fromString = String(value).split('T')[1];
  return fromString ? fromString.slice(0, 5) : '--:--';
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatBRL(value) {
  if (value == null || value === '' || isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMonthQuery(monthQuery) {
  if (monthQuery && /^\d{4}-\d{2}$/.test(monthQuery)) {
    const [yearRaw, monthRaw] = monthQuery.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (year >= 2000 && month >= 1 && month <= 12) {
      return new Date(year, month - 1, 1);
    }
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function previousMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function nextMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function buildMonthGrid(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateKey });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function findPatientByEmail(email) {
  if (!email) {
    return null;
  }

  return db.prepare('SELECT * FROM patients WHERE LOWER(email) = LOWER(?) LIMIT 1').get(email);
}

function findPatientByNameAndPhone(fullName, phone) {
  if (!fullName) {
    return null;
  }

  if (phone) {
    return db
      .prepare('SELECT * FROM patients WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1')
      .get(fullName, phone);
  }

  return db
    .prepare('SELECT * FROM patients WHERE full_name = ? ORDER BY id DESC LIMIT 1')
    .get(fullName);
}

function createPatientCode() {
  const row = db.prepare('SELECT MAX(id) AS max_id FROM patients').get();
  const nextNumber = Number(row?.max_id || 0) + 1;
  return toCodeNumber(nextNumber);
}

function getOrCreatePatientFromPayload(payload, explicitPatientId = null) {
  const fullName = String(payload.nomeCompleto || '').trim();
  const email = String(payload.email || '').trim().toLowerCase() || null;
  const phone = String(payload.whatsapp || payload.telefone || '').trim() || null;

  if (!fullName) {
    throw new Error('Nome da paciente é obrigatório para criar prontuário.');
  }

  let patient = null;
  if (explicitPatientId) {
    patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(explicitPatientId);
  }

  if (!patient && email) {
    patient = findPatientByEmail(email);
  }

  if (!patient) {
    patient = findPatientByNameAndPhone(fullName, phone);
  }

  if (patient) {
    db.prepare(
      `
        UPDATE patients
        SET full_name = ?, email = ?, phone = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(fullName, email, phone, nowIso(), patient.id);

    return patient.id;
  }

  const insertPatient = db.prepare(
    `
      INSERT INTO patients (patient_code, full_name, email, phone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const patientCode = createPatientCode();
      const result = insertPatient.run(patientCode, fullName, email, phone, nowIso(), nowIso());
      return Number(result.lastInsertRowid);
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE constraint failed: patients.patient_code')) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Não foi possível criar código único da paciente.');
}

function backfillLegacyPatients() {
  const legacy = db
    .prepare(
      `
      SELECT s.id, s.link_id, s.data_json
      FROM submissions s
      WHERE s.patient_id IS NULL
      ORDER BY s.id ASC
      `
    )
    .all();

  if (!legacy.length) {
    return;
  }

  const tx = db.transaction(() => {
    for (const item of legacy) {
      let payload = {};
      try {
        payload = JSON.parse(item.data_json || '{}');
      } catch (_error) {
        payload = {};
      }

      if (!payload.nomeCompleto || !payload.email) {
        continue;
      }

      const patientId = getOrCreatePatientFromPayload(payload);
      db.prepare('UPDATE submissions SET patient_id = ? WHERE id = ?').run(patientId, item.id);
      db.prepare('UPDATE patient_links SET patient_id = ? WHERE id = ? AND patient_id IS NULL').run(patientId, item.link_id);
    }
  });

  tx();
}

function isAuthenticated(req) {
  return Boolean(req.session.adminId);
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    res.redirect('/login');
    return;
  }
  next();
}

function verifyCsrf(req) {
  const token = req.body?._csrf;
  return token && token === req.session.csrfToken;
}

// CSRF estático para formulário público da paciente (sobrevive a restarts do servidor)
function patientCsrfToken(linkToken) {
  const secret = process.env.SESSION_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(String(linkToken)).digest('hex');
}

function verifyPatientCsrf(req, linkToken) {
  const submitted = req.body?._csrf;
  return submitted && submitted === patientCsrfToken(linkToken);
}

function escapeHtml(value) {
  const text = String(value ?? '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFieldValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.filter(Boolean).join(', ');
  }

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return '<span class="muted">Não preenchido</span>';
  }

  if (rawValue === 'on') {
    return 'Sim';
  }

  return escapeHtml(rawValue);
}

function renderField(field) {
  const name = escapeHtml(field.name);
  const label = escapeHtml(field.label);
  const required = field.required ? 'required' : '';

  if (field.type === 'textarea') {
    return `
      <label class="field">
        <span>${label}</span>
        <textarea name="${name}" rows="4" ${required}></textarea>
      </label>
    `;
  }

  if (field.type === 'radio') {
    const options = (field.options || [])
      .map(
        (option) => `
          <label class="option-line">
            <input type="radio" name="${name}" value="${escapeHtml(option)}" ${required}>
            <span>${escapeHtml(option)}</span>
          </label>
        `
      )
      .join('');

    return `
      <fieldset class="field">
        <legend>${label}</legend>
        <div class="option-grid">${options}</div>
      </fieldset>
    `;
  }

  if (field.type === 'checkbox-group') {
    const hasOutro = (field.options || []).includes('Outro');
    const outroInputId = `outro-text-${field.name}`;

    const options = (field.options || [])
      .map((option) => {
        const isOutro = hasOutro && option === 'Outro';
        const onchange = isOutro
          ? `onchange="(function(el){var t=document.getElementById('${outroInputId}');t.style.display=el.checked?'block':'none';if(!el.checked)t.querySelector('input').value='';})(this)"`
          : '';
        return `
          <label class="option-line">
            <input type="checkbox" name="${name}" value="${escapeHtml(option)}" ${onchange}>
            <span>${escapeHtml(option)}</span>
          </label>
          ${isOutro ? `
          <div id="${outroInputId}" style="display:none;grid-column:1/-1;padding:4px 0 4px 4px">
            <input type="text" name="${escapeHtml(field.name)}Outro" placeholder="Descreva sua suplementação…" style="max-width:420px;border-radius:11px">
          </div>` : ''}
        `;
      })
      .join('');

    return `
      <fieldset class="field">
        <legend>${label}</legend>
        <div class="option-grid">${options}</div>
      </fieldset>
    `;
  }

  if (field.type === 'checkbox-single') {
    return `
      <label class="option-line checkbox-single">
        <input type="checkbox" name="${name}" value="on" ${required}>
        <span>${label}</span>
      </label>
    `;
  }

  if (field.type === 'file') {
    const accept = escapeHtml(field.accept || '*/*');
    const multiple = field.multiple !== false ? 'multiple' : '';
    return `
      <label class="field">
        <span>${label}</span>
        <input type="file" name="${name}" accept="${accept}" ${multiple}>
      </label>
    `;
  }

  const inputType = escapeHtml(field.type || 'text');
  const min = typeof field.min === 'number' ? `min="${field.min}"` : '';
  const max = typeof field.max === 'number' ? `max="${field.max}"` : '';

  return `
    <label class="field">
      <span>${label}</span>
      <input type="${inputType}" name="${name}" ${required} ${min} ${max}>
    </label>
  `;
}

function layout({ title, body, userEmail = null, activeNav = '' }) {
  const authBlock = userEmail
    ? `
      <nav class="top-nav">
        <a href="/admin" class="top-nav-brand">
          <img src="/public/logo-fh.png" alt="Dra. Fran Hanel" class="top-nav-logo-img">
          <div>
            <div class="top-nav-logo">Dra. Fran Hanel</div>
            <div class="top-nav-sub">Biomedicina Estética • CRBM-5 015427</div>
          </div>
        </a>
        <div class="top-nav-links">
          <a class="top-nav-item ${activeNav === 'agenda' ? 'active' : ''}" href="/admin/agenda">📅 Agenda</a>
          <a class="top-nav-item ${activeNav === 'patients' ? 'active' : ''}" href="/admin/patients">👥 Pacientes</a>
          <a class="top-nav-item ${activeNav === 'simulador' ? 'active' : ''}" href="/admin/simulador">🧮 Simulador</a>
          <a class="top-nav-item ${activeNav === 'submissions' ? 'active' : ''}" href="/admin">📋 Questionários</a>
          <a class="top-nav-item ${activeNav === 'financeiro' ? 'active' : ''}" href="/admin/financeiro">💰 Financeiro</a>
          <a class="top-nav-item ${activeNav === 'materiais' ? 'active' : ''}" href="/admin/materiais">🧪 Insumos</a>
          <a class="top-nav-item ${activeNav === 'chat' ? 'active' : ''}" href="/admin/chat">🤖 Chat IA</a>
          <a class="top-nav-item ${activeNav === 'ia-memoria' ? 'active' : ''}" href="/admin/ia-memoria">🧠 Memória IA</a>
          <a class="top-nav-item ${activeNav === 'settings' ? 'active' : ''}" href="/admin/settings">⚙️ Configurações</a>
        </div>
        <div class="top-nav-user">
          <span class="muted" style="font-size:0.8rem">${escapeHtml(userEmail)}</span>
          <a href="/logout" class="btn tiny ghost" style="padding:4px 8px;font-size:0.75rem">Sair</a>
        </div>
      </nav>
    `
    : '';

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Marcellus&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="/public/styles.css">
      </head>
      <body>
        <div class="backdrop"></div>
        <main class="page-shell">
          ${authBlock}
          ${body}
        </main>
      </body>
    </html>
  `;
}

function renderAlert(message, tone = 'info') {
  if (!message) {
    return '';
  }
  return `<div class="alert ${tone}">${escapeHtml(message)}</div>`;
}

function renderHome(req) {
  const body = `
    <section class="hero-card">
      <p class="eyebrow">Plataforma clínica para consultoria skincare</p>
      <h1>Formulário por link + painel privado com IA</h1>
      <p class="hero-copy">
        Pacientes respondem por link único, enviam fotos do rosto e dos produtos.
        A profissional acessa tudo em um painel seguro e ainda usa chat com LLM para apoio clínico.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="/login">Entrar na área da profissional</a>
      </div>
    </section>
  `;

  return layout({ title: 'Plataforma Clínica', body, userEmail: req.session.adminEmail || null });
}

app.get('/healthz', (_req, res) => {
  const dbCheck = db.prepare('SELECT 1 AS ok').get();
  res.status(200).json({
    status: 'ok',
    app: 'plataforma-fran',
    timestamp: nowIso(),
    database: dbCheck?.ok === 1 ? 'ok' : 'error'
  });
});

app.get('/', (req, res) => {
  if (isAuthenticated(req)) {
    res.redirect('/admin');
    return;
  }

  res.send(renderHome(req));
});

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    res.redirect('/admin');
    return;
  }

  const body = `
    <section class="panel narrow">
      <h1>Entrar</h1>
      <p class="muted">Acesso exclusivo da profissional.</p>
      ${renderAlert(req.query.error)}
      <form method="post" action="/login" class="form-stack">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <label class="field">
          <span>E-mail</span>
          <input type="email" name="email" required>
        </label>
        <label class="field">
          <span>Senha</span>
          <div style="position:relative;display:flex;align-items:center;">
            <input type="password" name="password" id="login-password" required style="padding-right:44px;width:100%;">
            <button type="button" id="toggle-password" aria-label="Mostrar ou ocultar senha" title="Mostrar/ocultar senha" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;padding:6px;color:var(--muted);display:flex;align-items:center;justify-content:center;transition:color .2s;" onmouseenter="this.style.color='var(--primary)'" onmouseleave="this.style.color='var(--muted)'">
              <svg id="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </label>
        <button class="btn primary" type="submit">Entrar</button>
      </form>
      <script>
        (function() {
          const pwd = document.getElementById('login-password');
          const btn = document.getElementById('toggle-password');
          const eye = document.getElementById('eye-icon');
          if (!pwd || !btn || !eye) return;
          btn.addEventListener('click', function() {
            const isPassword = pwd.type === 'password';
            pwd.type = isPassword ? 'text' : 'password';
            eye.innerHTML = isPassword
              ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>'
              : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
          });
        })();
      </script>
    </section>
  `;

  res.send(layout({ title: 'Login', body }));
});

app.post('/login', (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const trimmedPassword = password.trim();

  const admin = db.prepare('SELECT * FROM admins WHERE LOWER(email) = ?').get(email);
  const isValid = admin && (bcrypt.compareSync(password, admin.password_hash) || bcrypt.compareSync(trimmedPassword, admin.password_hash));
  if (!isValid) {
    console.warn(`[AUTH] Tentativa de login inválida para: "${email}"`);
    res.redirect('/login?error=Credenciais inválidas');
    return;
  }

  req.session.adminId = admin.id;
  req.session.adminEmail = admin.email;
  res.redirect('/admin');
});

app.post('/logout', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/admin', requireAuth, (req, res) => {
  // Filtro de período para faturamento
  const revenueFrom = String(req.query.revenueFrom || '').slice(0, 10);
  const revenueTo   = String(req.query.revenueTo   || '').slice(0, 10);
  const hasFilter = /^\d{4}-\d{2}-\d{2}$/.test(revenueFrom) && /^\d{4}-\d{2}-\d{2}$/.test(revenueTo);

  const revenueQuery = hasFilter
    ? `SELECT COALESCE(SUM(value), 0) AS rev, COUNT(*) AS cnt FROM appointments WHERE date(start_at) BETWEEN ? AND ? AND status != 'cancelled'`
    : `SELECT COALESCE(SUM(value), 0) AS rev, COUNT(*) AS cnt FROM appointments WHERE start_at >= ? AND status != 'cancelled'`;
  const revenueParams = hasFilter ? [revenueFrom, revenueTo] : [nowIso()];
  const revenueRow = db.prepare(revenueQuery).get(...revenueParams);

  const counters = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM patients) AS total_patients,
        (SELECT COUNT(*) FROM submissions) AS total_submissions,
        (SELECT COUNT(*) FROM patient_links WHERE is_used = 0) AS pending_links,
        (SELECT COUNT(*) FROM appointments WHERE start_at >= ? AND status != 'cancelled') AS upcoming_appointments
      `
    )
    .get(nowIso());
  counters.upcoming_revenue = revenueRow.rev;
  counters.revenue_count = revenueRow.cnt;

  const rows = db
    .prepare(
      `
      SELECT
        l.id,
        l.token,
        l.patient_id,
        l.patient_name_hint,
        l.patient_email_hint,
        l.created_at,
        l.is_used,
        s.id AS submission_id,
        s.created_at AS submitted_at,
        p.id AS resolved_patient_id,
        p.patient_code,
        COALESCE(p.full_name, json_extract(s.data_json, '$.nomeCompleto'), l.patient_name_hint) AS patient_name,
        COALESCE(p.email, json_extract(s.data_json, '$.email'), l.patient_email_hint) AS patient_email
      FROM patient_links l
      LEFT JOIN submissions s ON s.link_id = l.id
      LEFT JOIN patients p ON p.id = COALESCE(s.patient_id, l.patient_id)
      ORDER BY l.id DESC
      `
    )
    .all();

  // Separa links pendentes dos já respondidos
  const pendingRows = rows
    .filter((row) => !row.is_used)
    .map((row) => {
      const patientLink = `${BASE_URL}/paciente/${row.token}`;
      const patientName = row.patient_name || '-';
      const patientEmail = row.patient_email || '-';
      const code = row.patient_code ? toCodeNumber(row.patient_code) : '----';
      const patientCell = row.resolved_patient_id
        ? `<a class="patient-link" href="/admin/patients/${row.resolved_patient_id}"><span class="patient-code">${escapeHtml(code)}</span> ${escapeHtml(patientName)}</a>`
        : `<span><span class="patient-code muted">${escapeHtml(code)}</span> ${escapeHtml(patientName)}</span>`;

      return `
        <tr>
          <td><span class="chip pending">Aguardando</span></td>
          <td>${patientCell}</td>
          <td>${escapeHtml(patientEmail)}</td>
          <td>
            <div class="link-inline">
              <code>${escapeHtml(patientLink)}</code>
              <button class="btn tiny copy-link-btn" type="button"
                onclick="navigator.clipboard.writeText('${escapeHtml(patientLink)}').then(()=>{this.textContent='✓ Copiado';setTimeout(()=>this.textContent='Copiar',2000)})">
                Copiar
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  // Links já respondidos: só mostra nome da paciente
  const answeredLinks = rows.filter((row) => row.is_used);
  const answeredChips = answeredLinks
    .map((row) => {
      const patientName = row.patient_name || 'Paciente';
      const code = row.patient_code ? toCodeNumber(row.patient_code) : '';
      if (row.resolved_patient_id) {
        return `<a class="chip done answered-chip" href="/admin/patients/${row.resolved_patient_id}">
          ${code ? `<span class="patient-code">${escapeHtml(code)}</span> ` : ''}${escapeHtml(patientName)} →
        </a>`;
      }
      return `<span class="chip done answered-chip">${escapeHtml(patientName)}</span>`;
    })
    .join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Painel profissional</p>
        <h1>Respostas das pacientes</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin/patients">Pacientes</a>
        <a class="btn" href="/admin/agenda">Agenda</a>
        <a class="btn" href="/admin/chat">Chat LLM</a>
        <a class="btn" href="/admin/ia-memoria">Memória da IA</a>
        <a class="btn" href="/admin/settings">Configurações</a>
        <form method="post" action="/logout">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <button class="btn ghost" type="submit">Sair</button>
        </form>
      </div>
    </header>

    <section class="panel">
      <h2>Visão geral</h2>
      <div class="stats-grid">
        <article class="stat-card">
          <span>Total de pacientes</span>
          <strong>${escapeHtml(counters.total_patients)}</strong>
        </article>
        <article class="stat-card">
          <span>Questionários respondidos</span>
          <strong>${escapeHtml(counters.total_submissions)}</strong>
        </article>
        <article class="stat-card">
          <span>Links aguardando resposta</span>
          <strong>${escapeHtml(counters.pending_links)}</strong>
        </article>
        <article class="stat-card">
          <span>Consultas futuras</span>
          <strong>${escapeHtml(counters.upcoming_appointments)}</strong>
        </article>
        <article class="stat-card">
          <span>Faturamento previsto</span>
          <strong>R$ ${escapeHtml(formatBRL(counters.upcoming_revenue))}</strong>
          <span class="muted" style="font-size:0.78rem">${hasFilter ? `${escapeHtml(revenueFrom)} → ${escapeHtml(revenueTo)}` : 'consultas futuras'}</span>
        </article>
      </div>

      <form class="revenue-filter-form" method="get" action="/admin">
        <span style="font-size:0.88rem;font-weight:600;color:var(--muted)">Filtrar faturamento por período:</span>
        <div class="date-time-pair" style="max-width:380px">
          <input type="date" name="revenueFrom" value="${escapeHtml(revenueFrom)}" placeholder="De">
          <input type="date" name="revenueTo"   value="${escapeHtml(revenueTo)}"   placeholder="Até">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn primary" type="submit">Calcular</button>
          ${hasFilter ? `<a class="btn" href="/admin">Limpar filtro</a>` : ''}
        </div>
      </form>
    </section>

    <section class="panel">
      <h2>Gerar link de questionário</h2>
      ${renderAlert(req.query.created ? `Link criado para token ${req.query.created}` : null, 'success')}
      <form class="form-grid" method="post" action="/admin/links">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <label class="field">
          <span>Nome da paciente (opcional)</span>
          <input type="text" name="patientNameHint">
        </label>
        <label class="field">
          <span>E-mail da paciente (opcional)</span>
          <input type="email" name="patientEmailHint">
        </label>
        <button class="btn primary" type="submit">Criar link</button>
      </form>
    </section>

    ${answeredLinks.length > 0 ? `
    <section class="panel">
      <h2>Pacientes que responderam</h2>
      <div class="answered-chips-wrap">
        ${answeredChips}
      </div>
    </section>` : ''}

    <section class="panel">
      <h2>Links aguardando resposta</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Paciente</th>
              <th>E-mail</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            ${pendingRows || '<tr><td colspan="4" class="muted">Nenhum link pendente. Todos os questionários foram respondidos!</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;

  res.send(layout({ title: 'Painel', body, userEmail: req.session.adminEmail }));
});

app.post('/admin/links', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const token = crypto.randomBytes(18).toString('hex');
  const patientNameHint = String(req.body.patientNameHint || '').trim() || null;
  const patientEmailHint = String(req.body.patientEmailHint || '').trim().toLowerCase() || null;
  const hintedPatient = patientEmailHint
    ? findPatientByEmail(patientEmailHint)
    : findPatientByNameAndPhone(patientNameHint, null);

  db.prepare(
    `
      INSERT INTO patient_links (token, patient_id, patient_name_hint, patient_email_hint, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(token, hintedPatient?.id || null, patientNameHint, patientEmailHint, nowIso());

  res.redirect(`/admin?created=${encodeURIComponent(token)}`);
});

app.get('/paciente/:token', (req, res) => {
  const token = String(req.params.token || '');
  const link = db.prepare('SELECT * FROM patient_links WHERE token = ?').get(token);

  if (!link) {
    res.status(404).send(
      layout({
        title: 'Link inválido',
        body: `<section class="panel"><h1>Link inválido</h1><p>Este link não existe.</p></section>`
      })
    );
    return;
  }

  if (link.is_used) {
    res.send(
      layout({
        title: 'Questionário já enviado',
        body: `<section class="panel"><h1>Questionário já enviado</h1><p>Obrigada! Sua resposta já foi registrada.</p></section>`
      })
    );
    return;
  }

  const sectionsHtml = formSections
    .map((section) => {
      const fieldsHtml = section.fields.map((field) => renderField(field)).join('');
      return `
        <section class="section-block" id="${escapeHtml(section.id)}">
          <h2>${escapeHtml(section.title)}</h2>
          <div class="fields-wrap">${fieldsHtml}</div>
        </section>
      `;
    })
    .join('');

  const body = `
    <div class="brand-clinical-header">
      <div class="brand-clinical-left">
        <img src="/public/logo-fh.png" alt="Dra. Fran Hanel" class="brand-clinical-monogram">
        <div>
          <h1 class="brand-clinical-title">Dra. Fran Hanel</h1>
          <p class="brand-clinical-sub">Biomedicina Estética Avançada & Integrativa</p>
        </div>
      </div>
      <div class="brand-clinical-meta">
        <div>CRBM-5: <strong>015427</strong></div>
        <div>Ficha Oficial de Anamnese</div>
      </div>
    </div>

    <div class="lgpd-notice-bar">
      <strong>LEI GERAL DE PROTEÇÃO DE DADOS (LGPD - LEI Nº 13.709/18):</strong>
      Os dados fornecidos são confidenciais e destinados exclusivamente ao planejamento diagnóstico, anamnese clínica de segurança e execução personalizada de tratamentos estéticos.
    </div>

    <form class="panel form-stack" method="post" action="/paciente/${escapeHtml(token)}" enctype="multipart/form-data">
      <input type="hidden" name="_csrf" value="${escapeHtml(patientCsrfToken(token))}">
      ${sectionsHtml}

      <section class="section-block" id="fotos">
        <h2>6. Envio de Fotos (Opcional)</h2>
        <p class="muted">
          Se desejar, envie fotos do seu rosto (frontal, perfis e close da queixa) ou produtos/exames para análise prévia da Dra. Fran Hanel.
          Prefira luz natural, sem maquiagem e sem filtros.
        </p>

        <label class="field">
          <span>Fotos do rosto (frontal e perfis)</span>
          <input type="file" name="facePhotos" accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp" multiple>
        </label>

        <label class="field">
          <span>Fotos de produtos da rotina ou exames</span>
          <input type="file" name="productPhotos" accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,application/pdf" multiple>
        </label>
      </section>

      <section class="section-block" id="assinatura">
        <h2>Assinatura Digital</h2>
        <p class="muted" style="margin-bottom:12px">Assine no quadro abaixo com o dedo (no celular) ou com o mouse para certificar a autenticidade dos dados prestados.</p>
        <div class="signature-wrap">
          <canvas id="signatureCanvas" class="signature-canvas" width="600" height="180"></canvas>
          <div class="signature-actions">
            <button type="button" class="btn tiny ghost" onclick="clearSignature()">Limpar assinatura</button>
          </div>
        </div>
        <input type="hidden" name="signatureData" id="signatureData">
      </section>

      <button class="btn primary block" type="submit" onclick="prepareSignature()" style="font-size:1.05rem;padding:14px">Salvar e Enviar Ficha de Anamnese</button>
    </form>

    <script>
    (function() {
      const canvas = document.getElementById('signatureCanvas');
      const ctx = canvas.getContext('2d');
      let drawing = false;

      function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const src = e.touches ? e.touches[0] : e;
        return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
      }

      canvas.addEventListener('mousedown', (e) => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
      canvas.addEventListener('mousemove', (e) => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#2f2520'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); });
      canvas.addEventListener('mouseup', () => drawing = false);
      canvas.addEventListener('mouseleave', () => drawing = false);
      canvas.addEventListener('touchstart', (e) => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
      canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#2f2520'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); }, { passive: false });
      canvas.addEventListener('touchend', () => drawing = false);

      window.clearSignature = function() { ctx.clearRect(0, 0, canvas.width, canvas.height); };
      window.prepareSignature = function() {
        const blank = document.createElement('canvas');
        blank.width = canvas.width; blank.height = canvas.height;
        const isEmpty = canvas.toDataURL() === blank.toDataURL();
        if (!isEmpty) document.getElementById('signatureData').value = canvas.toDataURL('image/png');
      };
    })();
    </script>
  `;

  res.send(layout({ title: 'Questionário', body }));
});

app.post('/paciente/:token', (req, res) => {
  uploadPatientFiles(req, res, (uploadError) => {
    if (uploadError) {
      let errorMsg = uploadError.message;
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        errorMsg = 'Uma ou mais fotos selecionadas ultrapassam o tamanho permitido (limite de 100 MB por imagem).';
      } else if (uploadError.code === 'LIMIT_FILE_COUNT') {
        errorMsg = 'Número máximo de fotos por envio excedido.';
      }
      res.status(400).send(
        layout({
          title: 'Erro no envio',
          body: `<section class="panel"><h1>Erro no envio</h1><p>${escapeHtml(errorMsg)}</p></section>`
        })
      );
      return;
    }

    const token = String(req.params.token || '');

    if (!verifyPatientCsrf(req, token)) {
      res.status(403).send(
        layout({
          title: 'Sessão expirada',
          body: `
            <section class="panel" style="text-align:center;max-width:480px;margin:0 auto;">
              <h2>Sessão expirada</h2>
              <p>O formulário ficou aberto por muito tempo e a sessão expirou.</p>
              <p>Por favor, <a href="/paciente/${escapeHtml(token)}">clique aqui para recarregar</a> e tente novamente.<br>
              Seus dados <strong>não foram perdidos</strong> — basta preencher novamente.</p>
            </section>
          `
        })
      );
      return;
    }
    const link = db.prepare('SELECT * FROM patient_links WHERE token = ?').get(token);

    if (!link) {
      res.status(404).send('Link inválido.');
      return;
    }

    if (link.is_used) {
      res.redirect(`/paciente/${encodeURIComponent(token)}`);
      return;
    }

    const payload = { ...req.body };
    delete payload._csrf;

    if (!payload.nomeCompleto || !payload.email || !payload.assinatura || !payload.dataAssinatura || !payload.termoResponsabilidadeAceito) {
      res.status(400).send(
        layout({
          title: 'Campos obrigatórios',
          body: '<section class="panel"><h1>Campos obrigatórios</h1><p>Preencha nome, e-mail, aceite do termo, assinatura e data.</p></section>'
        })
      );
      return;
    }

    const signatureData = String(req.body.signatureData || '').trim() || null;

    const insertSubmission = db.prepare(
      'INSERT INTO submissions (patient_id, link_id, token, data_json, signature_data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );

    let savedPatientId = null;
    let savedSubmissionId = null;

    const tx = db.transaction(() => {
      const patientId = getOrCreatePatientFromPayload(payload, link.patient_id || null);
      const result = insertSubmission.run(patientId, link.id, token, JSON.stringify(payload), signatureData, nowIso());
      const submissionId = result.lastInsertRowid;
      savedPatientId = patientId;
      savedSubmissionId = submissionId;
      const files = req.files || {};

      const insertFile = db.prepare(
        `
          INSERT INTO submission_files
            (submission_id, category, original_name, stored_name, mime_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      );

      for (const file of files.facePhotos || []) {
        insertFile.run(submissionId, 'face', file.originalname, file.filename, file.mimetype || null, nowIso());
      }

      for (const file of files.productPhotos || []) {
        insertFile.run(submissionId, 'product', file.originalname, file.filename, file.mimetype || null, nowIso());
      }

      for (const file of files.examFiles || []) {
        insertFile.run(submissionId, 'exam', file.originalname, file.filename, file.mimetype || null, nowIso());
      }

      db.prepare(
        'UPDATE patient_links SET patient_id = ?, is_used = 1, used_at = ? WHERE id = ?'
      ).run(patientId, nowIso(), link.id);
    });

    tx();

    // Dispara pré-análise automática em background (não bloqueia a resposta da paciente)
    setImmediate(() => {
      triggerAutoAnalysis(savedSubmissionId, savedPatientId).catch((err) => {
        console.error('[auto-analysis]', err.message);
      });
    });

    res.redirect('/obrigado');
  });
});

app.get('/obrigado', (_req, res) => {
  const body = `
    <section class="panel narrow">
      <h1>Recebido com sucesso</h1>
      <p>Obrigada por preencher o questionário. A profissional vai analisar suas respostas e fotos.</p>
    </section>
  `;

  res.send(layout({ title: 'Obrigada', body }));
});

// ─── PÁGINA PÚBLICA DE ASSINATURA DE TERMO DE CONSENTIMENTO ─────────
app.get('/termo/:token', (req, res) => {
  const token = String(req.params.token || '');
  const consent = db
    .prepare(`
      SELECT pc.*, p.full_name as patient_name, p.patient_code, ct.content as template_content
      FROM patient_consents pc
      JOIN patients p ON p.id = pc.patient_id
      LEFT JOIN consent_templates ct ON ct.id = pc.template_id
      WHERE pc.token = ?
    `)
    .get(token);

  if (!consent) {
    res.status(404).send(
      layout({
        title: 'Termo não encontrado',
        body: '<section class="panel narrow"><h1>Termo não encontrado</h1><p>Este link é inválido ou expirou.</p></section>'
      })
    );
    return;
  }

  // Se já estiver assinado
  if (consent.status === 'signed') {
    const signedDate = new Date(consent.signed_at).toLocaleString('pt-BR');
    const body = `
      <section class="panel narrow" style="text-align:center;padding:36px 24px">
        <div style="font-size:3rem;margin-bottom:12px">✅</div>
        <h1 style="margin:0 0 8px;font-size:1.5rem">Termo de Consentimento Assinado</h1>
        <p style="color:var(--muted);font-size:0.95rem;margin:0 0 18px">
          Obrigada, <strong>${escapeHtml(consent.signed_name || consent.patient_name)}</strong>!<br>
          Seu consentimento para <strong>${escapeHtml(consent.procedure_name)}</strong> foi registrado com sucesso em <strong>${escapeHtml(signedDate)}</strong>.
        </p>
        ${consent.signature_data ? `
          <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;max-width:320px;margin:0 auto 16px">
            <p style="margin:0 0 6px;font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase">Assinatura Registrada</p>
            <img src="${escapeHtml(consent.signature_data)}" alt="Assinatura" style="max-width:100%;height:auto;display:block">
          </div>
        ` : ''}
        <p class="muted" style="font-size:0.78rem">Código de segurança do prontuário: #${escapeHtml(toCodeNumber(consent.patient_code))}-${escapeHtml(consent.id)}</p>
      </section>
    `;
    res.send(layout({ title: 'Termo Assinado', body }));
    return;
  }

  // Se estiver pendente, exibe o termo para assinatura
  const today = new Date().toLocaleDateString('pt-BR');
  const termText = (consent.template_content || '')
    .replace(/\{\{NOME_PACIENTE\}\}/g, consent.patient_name || 'Paciente')
    .replace(/\{\{DATA\}\}/g, today);

  const body = `
    <div class="brand-clinical-header" style="max-width:760px;margin:0 auto 16px">
      <div class="brand-clinical-left">
        <img src="/public/logo-fh.png" alt="Dra. Fran Hanel" class="brand-clinical-monogram">
        <div>
          <h1 class="brand-clinical-title">Dra. Fran Hanel</h1>
          <p class="brand-clinical-sub">Biomedicina Estética Avançada & Integrativa</p>
        </div>
      </div>
      <div class="brand-clinical-meta">
        <div>CRBM-5: <strong>015427</strong></div>
        <div>TCLE Digital</div>
      </div>
    </div>

    <section class="panel" style="max-width:760px;margin:0 auto">
      <div style="text-align:center;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:20px">
        <span class="badge" style="background:#e8f5ed;color:#166534;margin-bottom:8px;display:inline-block">Termo de Consentimento Livre e Esclarecido</span>
        <h1 style="margin:0 0 8px;font-size:1.5rem;color:var(--accent)">${escapeHtml(consent.procedure_name)}</h1>
        <p class="muted" style="margin:0;font-size:0.9rem">
          Paciente: <strong>${escapeHtml(consent.patient_name)}</strong> · Data de Emissão: ${escapeHtml(today)}
        </p>
      </div>

      <div style="background:var(--bg-2);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:22px;white-space:pre-wrap;line-height:1.65;font-size:0.94rem;color:var(--text);max-height:420px;overflow-y:auto">
${escapeHtml(termText)}
      </div>

      <form method="post" action="/termo/${escapeHtml(token)}" id="termSignForm">
        <input type="hidden" name="signatureData" id="termSignatureData">

        <div class="field" style="margin-bottom:18px;background:var(--bg-2);padding:14px;border-radius:12px;border:1px solid var(--line)">
          <span style="display:block;margin-bottom:8px;font-weight:700">Autorização de Uso de Imagem (LGPD):</span>
          <div style="display:grid;gap:8px">
            <label class="option-line">
              <input type="radio" name="imageAuth" value="Prontuário Médico: Autorizo exclusivamente para acompanhamento de prontuário clínico e histórico confidencial." checked>
              <span><strong>Prontuário Confidencial:</strong> Autorizo exclusivamente para acompanhamento de prontuário clínico interno.</span>
            </label>
            <label class="option-line">
              <input type="radio" name="imageAuth" value="Divulgação e Ensino: Autorizo fotos/vídeos para fins didáticos, científicos e divulgação clínica profissional.">
              <span><strong>Divulgação e Ensino:</strong> Autorizo fotos de &quot;antes e depois&quot; para fins didáticos e divulgação clínica profissional.</span>
            </label>
            <label class="option-line">
              <input type="radio" name="imageAuth" value="Não Autorizo: Não autorizo o uso da minha imagem para divulgação.">
              <span><strong>Não Autorizo:</strong> Não autorizo a utilização da minha imagem fora do arquivo médico confidencial.</span>
            </label>
          </div>
        </div>

        <label class="field" style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:18px;background:#fbf9f4;padding:14px;border:1px solid var(--gold-border);border-radius:12px">
          <input type="checkbox" name="agreed" id="termAgreedCheck" required style="margin-top:3px;transform:scale(1.2)">
          <span style="font-size:0.9rem;line-height:1.4">
            Declaro que li atentamente, compreendi todas as informações, riscos, orientações pós-procedimento e concordo livremente com a realização de <strong>${escapeHtml(consent.procedure_name)}</strong>.
          </span>
        </label>

        <label class="field" style="margin-bottom:18px">
          <span>Nome Completo da Paciente (ou Responsável Legal) *</span>
          <input type="text" name="signedName" value="${escapeHtml(consent.patient_name)}" required placeholder="Seu nome completo">
        </label>

        <!-- Canvas de Assinatura -->
        <div class="field">
          <span>Assine aqui com o dedo (no celular) ou com o mouse *</span>
          <div class="signature-canvas-container">
            <canvas id="termCanvas" class="signature-canvas" width="480" height="170"></canvas>
            <p class="signature-hint">Desenhe sua assinatura no retângulo acima</p>
          </div>
          <div style="text-align:right">
            <button type="button" class="btn tiny ghost" onclick="clearTermCanvas()">Limpar Assinatura</button>
          </div>
        </div>

        <div style="margin-top:24px;text-align:center">
          <button class="btn primary" type="submit" style="padding:14px 32px;font-size:1.05rem;width:100%;max-width:380px">
            ✍️ Confirmar e Assinar Termo
          </button>
        </div>
      </form>
    </section>

    <script>
      const canvas = document.getElementById('termCanvas');
      const ctx = canvas.getContext('2d');
      let drawing = false;
      let hasDrawn = false;

      function resizeCanvas() {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * ratio;
        canvas.height = 170 * ratio;
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#2c231e';
      }

      window.addEventListener('resize', resizeCanvas);
      setTimeout(resizeCanvas, 50);

      function getPos(e) {
        const r = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - r.left, y: clientY - r.top };
      }

      function startDraw(e) {
        drawing = true;
        hasDrawn = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        if (e.touches) e.preventDefault();
      }

      function draw(e) {
        if (!drawing) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (e.touches) e.preventDefault();
      }

      function stopDraw() {
        if (!drawing) return;
        drawing = false;
        ctx.closePath();
      }

      canvas.addEventListener('mousedown', startDraw);
      canvas.addEventListener('mousemove', draw);
      window.addEventListener('mouseup', stopDraw);

      canvas.addEventListener('touchstart', startDraw, { passive: false });
      canvas.addEventListener('touchmove', draw, { passive: false });
      window.addEventListener('touchend', stopDraw);

      function clearTermCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawn = false;
        document.getElementById('termSignatureData').value = '';
      }

      document.getElementById('termSignForm').addEventListener('submit', function(e) {
        if (!hasDrawn) {
          alert('Por favor, faça sua assinatura digital no espaço indicado antes de enviar.');
          e.preventDefault();
          return;
        }
        document.getElementById('termSignatureData').value = canvas.toDataURL('image/png');
      });
    </script>
  `;

  res.send(layout({ title: `Termo — ${consent.procedure_name}`, body }));
});

app.post('/termo/:token', (req, res) => {
  const token = String(req.params.token || '');
  const consent = db.prepare('SELECT * FROM patient_consents WHERE token = ?').get(token);

  if (!consent) {
    res.status(404).send('Termo não encontrado.');
    return;
  }

  if (consent.status === 'signed') {
    res.redirect(`/termo/${encodeURIComponent(token)}`);
    return;
  }

  const signatureData = String(req.body.signatureData || req.body.signature_data || '').trim();
  const signedName = String(req.body.signedName || req.body.signed_name || '').trim();
  const imageAuth = String(req.body.imageAuth || '').trim();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

  if (!signatureData || !signatureData.startsWith('data:image/png')) {
    res.status(400).send(layout({
      title: 'Assinatura obrigatória',
      body: '<section class="panel narrow"><h1>Assinatura obrigatória</h1><p>Por favor, assine no campo indicado antes de confirmar.</p><p><a href="javascript:history.back()">Voltar e assinar</a></p></section>'
    }));
    return;
  }

  const notesText = imageAuth ? `Uso de Imagem: ${imageAuth}` : null;

  db.prepare(`
    UPDATE patient_consents
    SET status = 'signed', signature_data = ?, signed_name = ?, signed_at = ?, client_ip = ?, notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(signatureData, signedName, nowIso(), String(clientIp), notesText, consent.id);

  res.redirect(`/termo/${encodeURIComponent(token)}`);
});

app.get('/admin/patients', requireAuth, (req, res) => {
  const patients = db
    .prepare(
      `
      SELECT
        p.*,
        (SELECT COUNT(*) FROM submissions s WHERE s.patient_id = p.id) AS submission_count,
        (SELECT MAX(s.created_at) FROM submissions s WHERE s.patient_id = p.id) AS last_submission_at,
        (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) AS appointment_count
      FROM patients p
      ORDER BY p.id ASC
      `
    )
    .all();

  const rows = patients
    .map(
      (patient) => `
        <tr class="patient-row" data-name="${escapeHtml((patient.full_name || '').toLowerCase())}" data-phone="${escapeHtml((patient.phone || '').toLowerCase())}" data-email="${escapeHtml((patient.email || '').toLowerCase())}" data-code="${escapeHtml((toCodeNumber(patient.patient_code) || '').toLowerCase())}">
          <td><span class="patient-code">${escapeHtml(toCodeNumber(patient.patient_code))}</span></td>
          <td><a class="patient-link" href="/admin/patients/${patient.id}">${escapeHtml(patient.full_name)}</a></td>
          <td>${escapeHtml(patient.email || '-')}</td>
          <td>${escapeHtml(patient.phone || '-')}</td>
          <td>${escapeHtml(patient.submission_count)}</td>
          <td>${escapeHtml(patient.appointment_count)}</td>
          <td>${escapeHtml(formatDateTime(patient.last_submission_at))}</td>
        </tr>
      `
    )
    .join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Pacientes</p>
        <h1>Cadastro de pacientes</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
        <a class="btn primary" href="/admin/agenda">Abrir agenda</a>
      </div>
    </header>

    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px;flex-wrap:wrap">
        <div class="patient-search-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" id="patientSearchInput" placeholder="Buscar por nome, código (#0001), telefone ou e-mail..." oninput="filterPatients(this.value)">
          <button type="button" class="clear-btn" id="patientSearchClear" onclick="clearPatientSearch()" style="display:none" title="Limpar busca">✕</button>
        </div>
        <div style="font-size:0.86rem;color:var(--muted)" id="patientCountDisplay">
          Total: <strong>${patients.length}</strong> pacientes cadastradas
        </div>
      </div>

      <div class="table-wrap">
        <table id="patientsTable">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Telefone</th>
              <th>Questionários</th>
              <th>Consultas</th>
              <th>Última resposta</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="7" class="muted">Nenhuma paciente cadastrada ainda.</td></tr>'}
            <tr id="noResultsRow" style="display:none">
              <td colspan="7" class="muted" style="text-align:center;padding:28px 14px">
                🔍 Nenhuma paciente encontrada com o termo informado.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <script>
      function filterPatients(term) {
        term = (term || '').toLowerCase().trim();
        var clearBtn = document.getElementById('patientSearchClear');
        if (clearBtn) clearBtn.style.display = term ? 'block' : 'none';

        var rows = document.querySelectorAll('.patient-row');
        var visibleCount = 0;
        var totalCount = rows.length;

        rows.forEach(function(row) {
          var name = row.dataset.name || '';
          var phone = row.dataset.phone || '';
          var email = row.dataset.email || '';
          var code = row.dataset.code || '';
          var allText = (row.textContent || '').toLowerCase();

          if (!term || name.indexOf(term) !== -1 || phone.indexOf(term) !== -1 || email.indexOf(term) !== -1 || code.indexOf(term) !== -1 || allText.indexOf(term) !== -1) {
            row.style.display = '';
            visibleCount++;
          } else {
            row.style.display = 'none';
          }
        });

        var noResults = document.getElementById('noResultsRow');
        if (noResults) {
          noResults.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
        }

        var counter = document.getElementById('patientCountDisplay');
        if (counter) {
          if (term) {
            counter.innerHTML = 'Exibindo <strong>' + visibleCount + '</strong> de ' + totalCount + ' pacientes';
          } else {
            counter.innerHTML = 'Total: <strong>' + totalCount + '</strong> pacientes cadastradas';
          }
        }
      }

      function clearPatientSearch() {
        var input = document.getElementById('patientSearchInput');
        if (input) {
          input.value = '';
          filterPatients('');
          input.focus();
        }
      }
    </script>
  `;

  res.send(layout({ title: 'Pacientes', body, userEmail: req.session.adminEmail }));
});

app.get('/admin/patients/:id', requireAuth, (req, res) => {
  const patientId = Number(req.params.id);
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);

  if (!patient) {
    res.status(404).send('Paciente não encontrada.');
    return;
  }

  // 1. Histórico de questionários/anamneses
  const submissions = db
    .prepare(
      `
      SELECT
        s.*,
        l.token AS link_token
      FROM submissions s
      LEFT JOIN patient_links l ON l.id = s.link_id
      WHERE s.patient_id = ?
      ORDER BY s.created_at DESC
      `
    )
    .all(patientId);

  const latestSubmission = submissions[0] || null;
  let latestData = {};
  let submissionFiles = [];
  if (latestSubmission) {
    try {
      latestData = JSON.parse(latestSubmission.data_json || '{}');
    } catch (_e) {
      latestData = {};
    }
    submissionFiles = db
      .prepare('SELECT * FROM submission_files WHERE submission_id = ? ORDER BY id ASC')
      .all(latestSubmission.id);
  }

  // Link pendente (se houver)
  const pendingLink = db
    .prepare('SELECT * FROM patient_links WHERE patient_id = ? AND is_used = 0 ORDER BY id DESC LIMIT 1')
    .get(patientId);

  // 2. Evoluções do Prontuário
  const evolutions = db
    .prepare('SELECT * FROM patient_evolutions WHERE patient_id = ? ORDER BY session_date DESC, id DESC')
    .all(patientId);

  // 3. Galeria de Fotos / Marcações
  const mediaList = db
    .prepare('SELECT * FROM patient_media WHERE patient_id = ? ORDER BY created_at DESC')
    .all(patientId);

  // 4. Termos de Consentimento (TCLE)
  const consents = db
    .prepare(
      `
      SELECT
        pc.*,
        ct.title AS template_title,
        ct.slug AS template_slug
      FROM patient_consents pc
      LEFT JOIN consent_templates ct ON ct.id = pc.template_id
      WHERE pc.patient_id = ?
      ORDER BY pc.created_at DESC
      `
    )
    .all(patientId);

  // 5. Registros Financeiros / Procedimentos
  const financials = db
    .prepare('SELECT * FROM procedure_financials WHERE patient_id = ? ORDER BY created_at DESC')
    .all(patientId);

  // 6. Consultas na Agenda
  const appointments = db
    .prepare('SELECT * FROM appointments WHERE patient_id = ? ORDER BY start_at DESC LIMIT 50')
    .all(patientId);

  // 7. Mensagens da IA
  const aiMessages = db
    .prepare('SELECT * FROM chat_messages WHERE patient_id = ? ORDER BY created_at ASC')
    .all(patientId);

  // Insumos ativos e configurações da clínica para calculadora
  const materials = db.prepare('SELECT * FROM material_costs WHERE is_active = 1 ORDER BY category ASC, name ASC').all();
  const cardRates = db.prepare('SELECT * FROM card_fee_rates ORDER BY installments ASC, id ASC').all();
  const vmRates = cardRates.filter((r) => r.brand === 'visa_master');
  const eloRates = cardRates.filter((r) => r.brand === 'elo_amex');
  const clinicSettings = db.prepare('SELECT * FROM clinic_settings LIMIT 1').get() || {
    default_tax_pct: 6.0,
    default_card_fee_pct: 3.5,
    default_clinic_split_pct: 30.0
  };
  const officialSlugs = consentTemplates.map((t) => t.slug);
  const consentTemplatesList = db
    .prepare(`SELECT * FROM consent_templates WHERE slug IN (${officialSlugs.map(() => '?').join(',')})`)
    .all(...officialSlugs)
    .sort((a, b) => officialSlugs.indexOf(a.slug) - officialSlugs.indexOf(b.slug));

  // ─── Renderização da Ficha de Anamnese ───────────────────
  let anamneseSectionHtml = '';
  if (latestSubmission) {
    const facePhotos = submissionFiles.filter((f) => f.category === 'face');
    const productPhotos = submissionFiles.filter((f) => f.category === 'product');
    const examFiles = submissionFiles.filter((f) => f.category === 'exam');

    const renderImgGrid = (list) => {
      if (!list.length) return '<p class="muted" style="font-size:0.84rem">Nenhuma foto enviada.</p>';
      return `
        <div class="gallery-grid" style="grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:10px;">
          ${list.map((f) => `
            <div class="gallery-card" onclick="openLightbox('/admin/file/${f.id}')">
              <div class="gallery-thumb-wrap">
                <img class="gallery-thumb" src="/admin/file/${f.id}" alt="${escapeHtml(f.original_name)}" loading="lazy">
              </div>
              <div class="gallery-info" style="padding:6px 8px">
                <span class="gallery-caption" style="font-size:0.75rem">${escapeHtml(f.original_name)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    const sectionsAccordion = formSections
      .map((sec) => {
        const rows = sec.fields
          .map((f) => {
            const val = latestData[f.name];
            if (val === undefined || val === null || val === '') return '';
            return `
              <div style="display:grid;grid-template-columns:240px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f0e6de;font-size:0.88rem">
                <strong style="color:var(--text)">${escapeHtml(f.label)}:</strong>
                <span style="color:var(--text)">${safeFieldValue(val)}</span>
              </div>
            `;
          })
          .filter(Boolean)
          .join('');

        if (!rows) return '';
        return `
          <div style="margin-bottom:12px;background:var(--bg-2);padding:14px 18px;border-radius:12px;border:1px solid var(--line)">
            <h4 style="margin:0 0 8px;font-size:1rem;color:var(--accent)">${escapeHtml(sec.title)}</h4>
            ${rows}
          </div>
        `;
      })
      .join('');

    anamneseSectionHtml = `
      <section class="panel" id="anamnese">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px">
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <h2 style="margin:0">Ficha de Anamnese Clínica</h2>
              <span class="badge signed">Preenchida</span>
            </div>
            <p class="muted" style="margin:4px 0 0;font-size:0.84rem">
              Enviada em ${escapeHtml(formatDateTime(latestSubmission.created_at))} · Submissão #${latestSubmission.id}
            </p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn tiny" onclick="const b = document.getElementById('anamneseDetailsWrap'); b.style.display = b.style.display==='none'?'block':'none'">
              👁️ Expandir / Recolher Respostas
            </button>
            <a class="btn tiny gold" href="/admin/submissions/${latestSubmission.id}/print" target="_blank" rel="noopener">
              🖨️ Imprimir / PDF
            </a>
          </div>
        </div>

        <!-- Destaques Rápidos da Anamnese -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;background:#fffaf6;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:18px">
          <div>
            <span class="eyebrow" style="font-size:0.72rem">Queixa Principal</span>
            <p style="margin:4px 0 0;font-weight:600;font-size:0.92rem;color:var(--accent)">
              ${escapeHtml(latestData.queixaPrincipal || 'Não informada')}
            </p>
          </div>
          <div>
            <span class="eyebrow" style="font-size:0.72rem">Expectativa / Resultado</span>
            <p style="margin:4px 0 0;font-size:0.88rem;color:var(--text)">
              ${escapeHtml(Array.isArray(latestData.buscaResultado) ? latestData.buscaResultado.join(', ') : (latestData.buscaResultado || latestData.expectativaConsultoria || 'Não informada'))}
            </p>
          </div>
          <div>
            <span class="eyebrow" style="font-size:0.72rem">Alergias / Medicações</span>
            <p style="margin:4px 0 0;font-size:0.88rem;color:var(--text)">
              ${escapeHtml(
                (Array.isArray(latestData.alergiasConhecidas) ? latestData.alergiasConhecidas.join(', ') : latestData.alergiasConhecidas) ||
                latestData.outrasAlergias ||
                latestData.medicamentosContinuos ||
                'Nenhuma relatada'
              )}
            </p>
          </div>
          <div>
            <span class="eyebrow" style="font-size:0.72rem">Gestação / Lactação</span>
            <p style="margin:4px 0 0;font-size:0.88rem;color:var(--text)">
              ${escapeHtml(latestData.gestanteLactante || latestData.gravidaOuAmamentando || 'Não se aplica')}
            </p>
          </div>
        </div>

        <!-- Fotos enviadas na anamnese -->
        <div style="margin-bottom:18px">
          <h3 style="margin:0 0 10px;font-size:1rem;color:var(--text)">📸 Fotos enviadas pela paciente</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px">
            <div style="background:var(--bg-2);padding:14px;border-radius:12px;border:1px solid var(--line)">
              <p style="margin:0 0 8px;font-weight:700;font-size:0.85rem">Fotos do Rosto (${facePhotos.length})</p>
              ${renderImgGrid(facePhotos)}
            </div>
            <div style="background:var(--bg-2);padding:14px;border-radius:12px;border:1px solid var(--line)">
              <p style="margin:0 0 8px;font-weight:700;font-size:0.85rem">Fotos de Produtos em Uso (${productPhotos.length})</p>
              ${renderImgGrid(productPhotos)}
            </div>
            ${examFiles.length ? `
              <div style="background:var(--bg-2);padding:14px;border-radius:12px;border:1px solid var(--line)">
                <p style="margin:0 0 8px;font-weight:700;font-size:0.85rem">Exames Anexados (${examFiles.length})</p>
                ${renderImgGrid(examFiles)}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Respostas Detalhadas (Accordion) -->
        <div id="anamneseDetailsWrap" style="display:none;margin-top:16px">
          <h3 style="margin:0 0 12px;font-size:1.05rem">Todas as respostas do questionário</h3>
          ${sectionsAccordion}

          <!-- Assinatura da Anamnese -->
          ${latestSubmission.signature_data ? `
            <div style="margin-top:14px;background:#fff;padding:14px;border-radius:12px;border:1px solid var(--line);max-width:360px">
              <p style="margin:0 0 6px;font-size:0.8rem;font-weight:700;color:var(--muted);text-transform:uppercase">Assinatura Digital no Questionário</p>
              <img src="${escapeHtml(latestSubmission.signature_data)}" alt="Assinatura da paciente" style="max-width:100%;height:auto;border-bottom:1px solid #ddd">
              <p style="margin:4px 0 0;font-size:0.75rem;color:var(--muted)">Assinado em ${escapeHtml(formatDateTime(latestSubmission.created_at))}</p>
            </div>
          ` : ''}
        </div>
      </section>
    `;
  } else {
    // Caso ainda não tenha preenchido anamnese
    let pendingLinkHtml = '';
    if (pendingLink) {
      const linkUrl = `${BASE_URL}/paciente/${pendingLink.token}`;
      const msg = `Olá ${patient.full_name}! Segue o seu link exclusivo para preenchimento da ficha de anamnese antes da sua consulta: ${linkUrl}`;
      const waLink = toWhatsAppLink(patient.phone, msg);

      pendingLinkHtml = `
        <div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap">
          <input type="text" readonly value="${escapeHtml(linkUrl)}" id="anamnesePendingInput" style="padding:8px 12px;width:340px;border-radius:8px;border:1px solid var(--line);background:#fff;font-size:0.85rem">
          <button type="button" class="btn tiny" onclick="navigator.clipboard.writeText(document.getElementById('anamnesePendingInput').value);this.textContent='Copiado!';setTimeout(()=>this.textContent='Copiar link',2000)">Copiar link</button>
          ${waLink ? `<a class="btn tiny whatsapp" href="${escapeHtml(waLink)}" target="_blank" rel="noopener">📲 Enviar no WhatsApp da Paciente</a>` : ''}
        </div>
      `;
    } else {
      pendingLinkHtml = `
        <form method="post" action="/admin/patients/${patient.id}/generate-link" style="margin-top:12px">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <button class="btn primary" type="submit">📲 Gerar e Enviar Link de Anamnese</button>
        </form>
      `;
    }

    anamneseSectionHtml = `
      <section class="panel" id="anamnese" style="border-left:4px solid #c59b66">
        <div style="display:flex;align-items:center;gap:10px">
          <h2 style="margin:0">Ficha de Anamnese Clínica</h2>
          <span class="badge pending">Aguardando Preenchimento</span>
        </div>
        <p style="margin:8px 0 0;font-size:0.92rem;color:var(--muted)">
          Esta paciente ainda não respondeu ao questionário clínico de anamnese. Envie o link exclusivo para ela preencher no celular.
        </p>
        ${pendingLinkHtml}
      </section>
    `;
  }

  // ─── Renderização da Galeria de Fotos Clínicas (Marcações, Antes & Depois) ─
  const renderMediaCard = (m) => {
    const tagBadge = {
      marcacao: '<span class="badge marcacao">Marcação</span>',
      antes: '<span class="badge antes">Antes</span>',
      depois: '<span class="badge depois">Depois</span>',
      geral: '<span class="badge">Acompanhamento</span>'
    }[m.category] || '<span class="badge">Foto</span>';

    return `
      <div class="gallery-card">
        <div class="gallery-thumb-wrap" onclick="openLightbox('/admin/media/${m.id}')">
          <span class="gallery-tag-pill">${tagBadge}</span>
          <img class="gallery-thumb" src="/admin/media/${m.id}" alt="${escapeHtml(m.original_name)}" loading="lazy">
        </div>
        <div class="gallery-info">
          <span class="gallery-caption">${escapeHtml(m.notes || m.original_name)}</span>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
            <span class="gallery-date">${escapeHtml(formatDateTime(m.created_at))}</span>
            <form method="post" action="/admin/patients/${patient.id}/media/${m.id}/delete" onsubmit="return confirm('Deseja excluir esta foto?')" style="margin:0">
              <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
              <button class="btn tiny danger" style="padding:2px 6px;font-size:0.72rem" type="submit">Excluir</button>
            </form>
          </div>
        </div>
      </div>
    `;
  };

  const galleryHtml = `
    <section class="panel" id="galeria">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <h2 style="margin:0">Galeria Clínica — Marcações, Antes & Depois</h2>
          <p class="muted" style="margin:4px 0 0;font-size:0.84rem">
            Carregue fotos de planejamento, marcações com anestésico/lápis, antes e depois de procedimentos.
          </p>
        </div>
        <button class="btn tiny primary" onclick="const f = document.getElementById('uploadMediaBox'); f.style.display = f.style.display==='none'?'block':'none'">
          + Carregar Novas Fotos
        </button>
      </div>

      <!-- Formulário de Upload de Fotos Clínicas -->
      <div id="uploadMediaBox" style="${req.query.error ? 'display:block;' : 'display:none;'}background:var(--bg-2);padding:18px;border-radius:14px;border:1px dashed var(--accent);margin-bottom:18px">
        <form id="mediaUploadForm" method="post" action="/admin/patients/${patient.id}/media" enctype="multipart/form-data" onsubmit="return handleMediaUploadSubmit(this)">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <div class="form-grid">
            <label class="field">
              <span>Selecionar Fotos (pode marcar várias) *</span>
              <input type="file" name="mediaFiles" id="mediaFilesInput" multiple accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp" required onchange="handleMediaFilesSelected(this)">
              <div id="mediaFilesSelectedInfo" style="margin-top:6px;font-size:0.84rem;font-weight:600;color:var(--accent)"></div>
            </label>
            <label class="field">
              <span>Categoria da Imagem *</span>
              <select name="category" required>
                <option value="marcacao">🏷️ Marcação Clínica / Mapeamento Facial</option>
                <option value="antes">🏷️ Foto de Antes</option>
                <option value="depois">🏷️ Foto de Depois</option>
                <option value="geral">🏷️ Acompanhamento / Retorno / Outro</option>
              </select>
            </label>
            <label class="field" style="grid-column:1/-1">
              <span>Legenda / Observação</span>
              <input type="text" name="notes" placeholder="Ex.: Marcação glabela e frontal 42U · Antes preenchimento malar e queixo">
            </label>
          </div>
          <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
            <button class="btn primary" id="mediaUploadSubmitBtn" type="submit">📤 Salvar Fotos na Pasta</button>
            <button class="btn ghost" type="button" onclick="document.getElementById('uploadMediaBox').style.display='none'">Cancelar</button>
          </div>
        </form>
      </div>

      <!-- Grid de Fotos -->
      ${mediaList.length ? `
        <div class="gallery-grid">
          ${mediaList.map(renderMediaCard).join('')}
        </div>
      ` : `
        <div style="text-align:center;padding:28px 14px;background:var(--bg-2);border-radius:12px;border:1px dashed var(--line);color:var(--muted)">
          <p style="margin:0;font-size:0.95rem">Nenhuma foto carregada ainda nesta pasta.</p>
          <p style="margin:4px 0 0;font-size:0.82rem">Clique em <strong>+ Carregar Novas Fotos</strong> para adicionar marcações e fotos de antes/depois.</p>
        </div>
      `}
    </section>
  `;

  // ─── Renderização do Prontuário & Evoluções Clínicas ("Infinito" e Editável) ──
  const evolutionsListHtml = evolutions.length
    ? evolutions
        .map((evo) => `
          <article class="evolution-item" id="evo-${evo.id}">
            <div class="evolution-header">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="evolution-date">📅 ${escapeHtml(evo.session_date)}</span>
                ${evo.procedure_name ? `<span class="evolution-procedure">${escapeHtml(evo.procedure_name)}</span>` : ''}
              </div>
              <div class="evolution-actions">
                <button type="button" class="btn tiny" onclick="document.getElementById('evo-view-${evo.id}').style.display='none';document.getElementById('evo-edit-${evo.id}').style.display='block'">
                  ✏️ Editar
                </button>
                <form method="post" action="/admin/patients/${patient.id}/evolutions/${evo.id}/delete" onsubmit="return confirm('Excluir esta anotação do prontuário?')" style="margin:0">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <button class="btn tiny danger" type="submit">🗑️</button>
                </form>
              </div>
            </div>

            <!-- Visualização da Evolução -->
            <div class="evolution-body" id="evo-view-${evo.id}">
              ${escapeHtml(evo.notes)}
            </div>

            <!-- Modo de Edição da Evolução -->
            <div id="evo-edit-${evo.id}" style="display:none;margin-top:10px">
              <form method="post" action="/admin/patients/${patient.id}/evolutions/${evo.id}/edit">
                <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                <div style="display:grid;grid-template-columns:180px 1fr;gap:10px;margin-bottom:8px">
                  <input type="date" name="session_date" value="${escapeHtml(evo.session_date)}" required style="padding:6px 10px;border-radius:8px;border:1px solid var(--line)">
                  <input type="text" name="procedure_name" value="${escapeHtml(evo.procedure_name || '')}" placeholder="Procedimento / Título" style="padding:6px 10px;border-radius:8px;border:1px solid var(--line)">
                </div>
                <textarea name="notes" rows="4" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);font-family:inherit;font-size:0.92rem;margin-bottom:8px" required>${escapeHtml(evo.notes)}</textarea>
                <div style="display:flex;gap:6px">
                  <button class="btn tiny primary" type="submit">Salvar Alterações</button>
                  <button class="btn tiny ghost" type="button" onclick="document.getElementById('evo-view-${evo.id}').style.display='block';document.getElementById('evo-edit-${evo.id}').style.display='none'">Cancelar</button>
                </div>
              </form>
            </div>
          </article>
        `)
        .join('')
    : '<p class="muted" style="padding:14px 0">Nenhum registro de atendimento cadastrado ainda.</p>';

  const evolutionsSectionHtml = `
    <section class="panel" id="evolucoes">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h2 style="margin:0">Prontuário & Evoluções Clínicas</h2>
          <p class="muted" style="margin:4px 0 0;font-size:0.84rem">
            Histórico contínuo e evolutivo da paciente. Cada consulta pode ser salva e reeditada a qualquer momento.
          </p>
        </div>
        <span class="badge" style="background:#f3ece5;color:var(--text)">${evolutions.length} atendimentos registrados</span>
      </div>

      <!-- Linha do tempo de atendimentos passados -->
      <div class="evolution-timeline">
        ${evolutionsListHtml}
      </div>

      <!-- Novo Registro de Consulta (Campo Contínuo / Infinito) -->
      <div class="new-evolution-box">
        <h3>➕ Novo Registro de Atendimento / Consulta</h3>
        <form method="post" action="/admin/patients/${patient.id}/evolutions">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <div style="display:grid;grid-template-columns:180px 1fr;gap:12px;margin-bottom:10px">
            <label class="field" style="margin:0">
              <span>Data da Sessão *</span>
              <input type="date" name="session_date" value="${new Date().toISOString().slice(0, 10)}" required>
            </label>
            <label class="field" style="margin:0">
              <span>Procedimento Realizado / Título</span>
              <input type="text" name="procedure_name" placeholder="Ex.: Aplicação Botox 50U · Retorno 15 dias · Limpeza de pele">
            </label>
          </div>
          <label class="field">
            <span>Anotações Clínicas & Evolução do Atendimento *</span>
            <textarea name="notes" rows="4" placeholder="Descreva os produtos e doses utilizadas, áreas aplicadas, lote dos insumos, anestésico, reação da paciente, orientações pós-procedimento e próximos passos..." required></textarea>
          </label>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn primary" type="submit">💾 Salvar Registro no Prontuário</button>
          </div>
        </form>
      </div>
    </section>
  `;

  // ─── Renderização dos Termos de Consentimento (TCLE) ─────
  const issuedToken = String(req.query.issued_consent || '');
  const consentCardsHtml = consents.length
    ? consents
        .map((c) => {
          const isSigned = c.status === 'signed';
          const termUrl = `${BASE_URL}/termo/${c.token}`;
          const isJustIssued = issuedToken && c.token === issuedToken;
          const msg = `Olá ${patient.full_name}! Por favor, acesse o link a seguir para ler e assinar digitalmente o seu Termo de Consentimento para ${c.procedure_name}: ${termUrl}`;
          const waLink = toWhatsAppLink(patient.phone, msg);

          return `
            <div class="consent-card" style="${isJustIssued ? 'border: 2px solid var(--accent); background: #fdfbf7;' : ''}">
              <div class="consent-card-header">
                <div>
                  <h4 class="consent-card-title">${escapeHtml(c.procedure_name)}</h4>
                  <div class="consent-card-meta">
                    Emitido em: ${escapeHtml(formatDateTime(c.created_at))}
                  </div>
                </div>
                ${isSigned
                  ? `<span class="badge signed">✅ Assinado</span>`
                  : `<span class="badge pending">⏳ Aguardando Assinatura</span>`
                }
              </div>

              <div>
                ${isSigned ? `
                  <p style="margin:0 0 6px;font-size:0.84rem;color:#166534">
                    Assinado por <strong>${escapeHtml(c.signed_name || patient.full_name)}</strong><br>
                    Data/Hora: <strong>${escapeHtml(formatDateTime(c.signed_at))}</strong>${c.client_ip ? ` · IP: ${escapeHtml(c.client_ip)}` : ''}
                  </p>
                  ${c.notes ? `<p style="margin:4px 0 8px;font-size:0.78rem;color:var(--muted);background:var(--bg);padding:6px 10px;border-radius:8px">${escapeHtml(c.notes)}</p>` : ''}
                  ${c.signature_data ? `
                    <div style="background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px;max-width:240px;margin-top:6px">
                      <img src="${escapeHtml(c.signature_data)}" alt="Assinatura" style="max-width:100%;height:auto;display:block">
                    </div>
                  ` : ''}
                ` : `
                  <p style="margin:0 0 8px;font-size:0.83rem;color:var(--muted)">
                    Link gerado para a paciente assinar no celular ou tablet:
                  </p>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                    <input type="text" readonly value="${escapeHtml(termUrl)}" id="termInput-${c.id}" style="padding:6px 8px;width:200px;font-size:0.75rem;border-radius:6px;border:1px solid var(--line);background:#fff">
                    <button type="button" class="btn tiny" onclick="navigator.clipboard.writeText(document.getElementById('termInput-${c.id}').value);this.textContent='Copiado!';setTimeout(()=>this.textContent='Copiar Link',2000)">Copiar Link</button>
                    ${waLink ? `<a class="btn tiny whatsapp" href="${escapeHtml(waLink)}" target="_blank" rel="noopener">📲 Enviar no WhatsApp</a>` : ''}
                    <a class="btn tiny ghost" href="${escapeHtml(termUrl)}" target="_blank" rel="noopener" title="Abrir para assinar presencialmente no consultório">📱 Assinar na Clínica</a>
                  </div>
                `}
              </div>

              <div class="consent-card-actions">
                <a class="btn tiny gold" href="/admin/consents/${c.id}" target="_blank" rel="noopener">
                  📄 Visualizar / Imprimir Termo
                </a>
                <form method="post" action="/admin/patients/${patient.id}/consents/${c.id}/delete" onsubmit="return confirm('Deseja excluir este termo?')" style="margin:0">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <button class="btn tiny danger" type="submit">Excluir</button>
                </form>
              </div>
            </div>
          `;
        })
        .join('')
    : '<p class="muted" style="padding:14px 0">Nenhum termo emitido para esta paciente ainda. Utilize os botões abaixo para emitir o primeiro termo.</p>';

  const consentSectionHtml = `
    <section class="panel" id="termos">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <h2 style="margin:0">Termos de Consentimento Livre e Esclarecido (TCLE)</h2>
            <span class="badge" style="background:#e9f2ec;color:var(--accent);font-weight:700">${consents.length} termo(s)</span>
          </div>
          <p class="muted" style="margin:4px 0 0;font-size:0.84rem">
            Emita o termo oficial correspondente a cada procedimento para a paciente assinar no celular. Todos os termos assinados ficam arquivados permanentemente nesta pasta.
          </p>
        </div>
      </div>

      ${issuedToken ? `
        <div class="alert success" style="margin-bottom:16px">
          ✅ <strong>Termo emitido com sucesso!</strong> Encaminhe pelo botão do WhatsApp ou copie o link exclusivo abaixo para a paciente assinar.
        </div>
      ` : ''}

      <!-- Grade de Emissão de Todos os 9 Termos Oficiais -->
      <div class="tcle-actions-panel">
        <div class="tcle-actions-title">
          <span>✍️ Emitir Novo Termo de Consentimento para ${escapeHtml(patient.full_name)}:</span>
        </div>
        <p class="muted" style="margin:0 0 14px;font-size:0.84rem">
          Selecione o procedimento para emitir o termo oficial e encaminhar o link de assinatura para a paciente:
        </p>
        <div class="tcle-btn-grid">
          ${consentTemplatesList.map((tpl) => {
            const icons = {
              'toxina-botulinica': '💉',
              'preenchimento-facial': '✨',
              'preenchimento-labial': '💋',
              'bioestimulador-caha': '🌟',
              'bioestimulador-plla': '🧬',
              'fios-de-pdo': '🪡',
              'laser-thulium-lavieen': '⚡',
              'ultrassom-focado': '🔬',
              'hialuronidase-off-label': '💧'
            };
            const icon = icons[tpl.slug] || '📋';
            return `
              <form method="post" action="/admin/patients/${patient.id}/consents" style="margin:0">
                <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                <input type="hidden" name="templateId" value="${tpl.id}">
                <input type="hidden" name="procedureName" value="${escapeHtml(tpl.procedure_name)}">
                <button class="tcle-emit-btn" type="submit" title="Emitir termo de ${escapeHtml(tpl.procedure_name)}">
                  <span class="icon">${icon}</span>
                  <span>${escapeHtml(tpl.procedure_name)}</span>
                </button>
              </form>
            `;
          }).join('')}
        </div>
      </div>

      <div class="consent-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:14px">
        ${consentCardsHtml}
      </div>
    </section>
  `;

  // ─── Renderização da Calculadora de Custos & Lucro Líquido ─
  const financialRowsHtml = financials.length
    ? financials.map((f) => {
        const payLabel = f.payment_method ? f.payment_method.toUpperCase().replace('_', ' ') : 'PIX';
        const instLabel = f.installments && f.installments > 1 ? ` (${f.installments}x)` : '';
        return `
        <tr>
          <td>${escapeHtml(formatDateTime(f.created_at))}</td>
          <td>
            <strong>${escapeHtml(f.description)}</strong>
            <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(payLabel + instLabel)}</div>
          </td>
          <td><strong>R$ ${escapeHtml(formatBRL(f.gross_value))}</strong></td>
          <td style="color:var(--danger)">- R$ ${escapeHtml(formatBRL(f.materials_cost))}</td>
          <td style="color:var(--muted)">- R$ ${escapeHtml(formatBRL(f.card_fee_amount))} (${f.card_fee_pct}%)</td>
          <td style="color:#b45309">- R$ ${escapeHtml(formatBRL(f.tax_amount))} (6%)</td>
          <td style="color:#9a3412">- R$ ${escapeHtml(formatBRL(f.clinic_split_amount))} (30%)</td>
          <td style="color:#15803d;font-weight:700">R$ ${escapeHtml(formatBRL(f.net_profit))}</td>
          <td>
            <form method="post" action="/admin/patients/${patient.id}/financial/${f.id}/delete" onsubmit="return confirm('Excluir este registro financeiro?')" style="margin:0">
              <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
              <button class="btn tiny danger" type="submit">Excluir</button>
            </form>
          </td>
        </tr>
      `;
      }).join('')
    : '<tr><td colspan="9" class="muted">Nenhum cálculo registrado para esta paciente ainda.</td></tr>';

  const financialSectionHtml = `
    <section class="panel" id="financeiro">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <div>
          <h2 style="margin:0">Custos, Repasses & Lucro Líquido do Procedimento</h2>
          <p class="muted" style="margin:4px 0 0;font-size:0.84rem">
            Cálculo oficial sequencial: Valor Cobrado → (-) Cartão → (-) 6% Imposto → (-) 30% Clínica → (-) Materiais = Lucro Fran.
          </p>
        </div>
      </div>

      <!-- Calculadora Interativa -->
      <div class="calc-container">
        <div class="calc-inputs-card">
          <form method="post" action="/admin/patients/${patient.id}/financial" id="calcForm">
            <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
            <input type="hidden" name="materials_json" id="calcMaterialsJson" value="[]">
            <input type="hidden" name="tax_amount" id="calcTaxAmount" value="0">
            <input type="hidden" name="card_fee_amount" id="calcCardFeeAmount" value="0">
            <input type="hidden" name="clinic_split_amount" id="calcClinicSplitAmount" value="0">
            <input type="hidden" name="net_profit" id="calcNetProfitHidden" value="0">

            <label class="field">
              <span>Procedimento Realizado *</span>
              <input type="text" name="description" id="calcDescription" placeholder="Ex.: Toxina Botulínica 50U + Preenchimento Labial" required>
            </label>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label class="field">
                <span>Valor Cobrado da Paciente (R$) *</span>
                <input type="number" step="0.01" min="0" name="gross_value" id="calcGrossValue" placeholder="1200,00" required oninput="recalcProfit()">
              </label>
              <label class="field">
                <span>Custo Extra de Materiais (R$)</span>
                <input type="number" step="0.01" min="0" name="extra_materials" id="calcExtraMaterials" placeholder="0,00" oninput="recalcProfit()">
              </label>
            </div>

            <div class="payment-brands-container">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
                <span style="font-weight:700;font-size:0.9rem;color:var(--text)">Forma de Pagamento da Paciente *</span>
                <span style="font-size:0.8rem;color:var(--accent);font-weight:600" id="calcSelectedPaymentLabel">Selecionado: Pix à Vista (0%)</span>
              </div>

              <!-- Atalhos rápidos À Vista (Sem Taxa) -->
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
                <button type="button" class="pay-shortcut-btn active" id="calcBtnPix" onclick="selectDirectPayment('pix', 0, 1, 'Pix à Vista')">
                  🟢 Pix à Vista (0%)
                </button>
                <button type="button" class="pay-shortcut-btn" id="calcBtnDinheiro" onclick="selectDirectPayment('dinheiro', 0, 1, 'Dinheiro à Vista')">
                  💵 Dinheiro à Vista (0%)
                </button>
              </div>

              <!-- Dois campos dedicados por bandeira (Ton Black até 21x) -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label class="field brand-select-field" style="margin:0">
                  <span style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text)">
                    <span>💳</span> Visa & Mastercard (1x a 21x)
                  </span>
                  <select id="calcPayVisaMaster" onchange="selectBrandOption(this, 'visa_master')">
                    <option value="">Selecione opção Visa / Master...</option>
                    ${vmRates.map((r) => `
                      <option value="${escapeHtml(r.method_code)}" data-fee="${r.fee_pct}" data-installments="${r.installments}" data-label="${escapeHtml(r.label)}">
                        ${escapeHtml(r.label)} — ${r.fee_pct.toFixed(2).replace('.', ',')}%
                      </option>
                    `).join('')}
                  </select>
                </label>

                <label class="field brand-select-field" style="margin:0">
                  <span style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text)">
                    <span>💳</span> Elo & American Express (1x a 21x)
                  </span>
                  <select id="calcPayEloAmex" onchange="selectBrandOption(this, 'elo_amex')">
                    <option value="">Selecione opção Elo / Amex...</option>
                    ${eloRates.map((r) => `
                      <option value="${escapeHtml(r.method_code)}" data-fee="${r.fee_pct}" data-installments="${r.installments}" data-label="${escapeHtml(r.label)}">
                        ${escapeHtml(r.label)} — ${r.fee_pct.toFixed(2).replace('.', ',')}%
                      </option>
                    `).join('')}
                  </select>
                </label>
              </div>

              <!-- Inputs hidden para persistência no banco -->
              <input type="hidden" name="payment_method" id="calcPaymentMethod" value="pix">
              <input type="hidden" name="installments" id="calcInstallments" value="1">
            </div>

            <!-- Seleção de Materiais Agrupados por Categoria -->
            <label class="field">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span>Insumos, Materiais & Tecnologias Utilizados</span>
                <span class="muted" style="font-size:0.78rem">Selecione e ajuste as quantidades</span>
              </div>
              <div class="materials-picker-container">
                ${renderMaterialsPickerHtml({ materials, prefix: 'calc', onchangeFn: 'recalcProfit' })}
              </div>
            </label>

            <!-- Taxas configuradas -->
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-top:10px">
              <label class="field">
                <span>Taxa Cartão (%)</span>
                <input type="number" step="0.01" name="card_fee_pct" id="calcCardFeePct" value="0.00" oninput="recalcProfit()">
              </label>
              <label class="field">
                <span>Imposto (%)</span>
                <input type="number" step="0.1" name="tax_pct" id="calcTaxPct" value="${clinicSettings.default_tax_pct || 6.0}" oninput="recalcProfit()">
              </label>
              <label class="field">
                <span>Repasse Clínica (%)</span>
                <input type="number" step="0.1" name="clinic_split_pct" id="calcClinicSplitPct" value="${clinicSettings.default_clinic_split_pct || 30.0}" oninput="recalcProfit()">
              </label>
            </div>

            <div style="margin-top:14px">
              <button class="btn primary" type="submit">💾 Salvar Registro Financeiro deste Atendimento</button>
            </div>
          </form>
        </div>

        <!-- Recibo em Tempo Real (6 Passos Oficiais) -->
        <div class="calc-receipt-card">
          <h3 class="calc-receipt-title">Extrato de Rentabilidade (6 Passos)</h3>

          <div class="step-card">
            <div class="step-badge">1</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>Faturamento Cobrado</span>
                <strong id="liveGross">R$ 0,00</strong>
              </div>
              <div class="step-info-sub" id="liveInstallmentLabel">À vista (Pix)</div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #f59e0b">
            <div class="step-badge" style="background:#f59e0b">2</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Taxa Cartão (<span id="liveCardPct">0.00</span>%)</span>
                <strong style="color:var(--danger)" id="liveCardFee">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Subtotal após taxa: <strong id="liveAfterCard" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #3b82f6">
            <div class="step-badge" style="background:#3b82f6">3</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Imposto (<span id="liveTaxPct">6.0</span>% pós-cartão)</span>
                <strong style="color:var(--danger)" id="liveTax">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Subtotal após imposto: <strong id="liveAfterTax" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #8b5cf6">
            <div class="step-badge" style="background:#8b5cf6">4</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Repasse Clínica (<span id="liveClinicPct">30.0</span>% pós-imposto)</span>
                <strong style="color:#9a3412" id="liveClinicSplit">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Cota Profissional Fran: <strong id="liveProfSubtotal" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #ef4444">
            <div class="step-badge" style="background:#ef4444">5</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Custo Insumos & Tecnologias</span>
                <strong style="color:var(--danger)" id="liveMaterials">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub" id="liveMaterialsCount">0 itens selecionados</div>
            </div>
          </div>

          <div class="receipt-total-profit" style="margin-top:12px">
            <div>
              <div style="font-size:0.75rem;letter-spacing:0.05em;text-transform:uppercase;opacity:0.9">6. LUCRO LÍQUIDO FINAL FRAN</div>
              <div style="font-size:0.8rem;font-weight:normal;opacity:0.9" id="liveMarginPct">Margem: 0%</div>
            </div>
            <span class="profit-badge" id="liveNetProfit" style="font-size:1.45rem">R$ 0,00</span>
          </div>

          <p class="muted" style="font-size:0.74rem;margin-top:12px;text-align:center">
            * Ordem oficial: 1. Bruto → 2. (-) Cartão → 3. (-) 6% Imposto → 4. (-) 30% Clínica → 5. (-) Insumos = 6. Lucro Líquido.
          </p>
        </div>
      </div>

      <!-- Tabela de Histórico Financeiro da Paciente -->
      <div style="margin-top:24px">
        <h3 style="margin:0 0 10px;font-size:1.05rem">Histórico de procedimentos realizados para esta paciente</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Procedimento / Pgto</th>
                <th>Valor Bruto</th>
                <th>Insumos</th>
                <th>Taxa Cartão</th>
                <th>Imposto 6%</th>
                <th>Repasse Clínica 30%</th>
                <th>Lucro Líquido</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              ${financialRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  // ─── Renderização das Consultas da Agenda & IA ───────────
  const appointmentsRows = appointments
    .map(
      (appt) => {
        const startStr = appt.start_at || '';
        const endStr = appt.end_at || '';
        const sDate = startStr.slice(0, 10);
        const sTime = startStr.slice(11, 16);
        const eDate = endStr.slice(0, 10);
        const eTime = endStr.slice(11, 16);
        const apptDataAttr = JSON.stringify({
          id: appt.id,
          title: appt.title || '',
          value: appt.value != null ? String(appt.value) : '',
          notes: appt.notes || '',
          startDate: sDate,
          startTime: sTime,
          endDate: eDate,
          endTime: eTime,
          status: appt.status || 'scheduled'
        }).replace(/'/g, '&#39;');

        return `
          <tr>
            <td>${escapeHtml(formatDateTime(appt.start_at))}</td>
            <td>${escapeHtml(appt.title)}</td>
            <td>${appt.value != null ? `R$ ${escapeHtml(formatBRL(appt.value))}` : '<span class="muted">—</span>'}</td>
            <td>${escapeHtml(appt.notes || '-')}</td>
            <td>
              <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
                <button class="btn tiny" type="button" data-appt='${apptDataAttr}' onclick="openPatientApptModalFromBtn(this)">✏️ Editar</button>
                ${appt.status !== 'cancelled' ? `
                <form method="post" action="/admin/agenda/${appt.id}/status" style="display:inline">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <input type="hidden" name="returnPatient" value="${patient.id}">
                  ${appt.status !== 'confirmed' ? `<button class="btn tiny" name="status" value="confirmed" title="Confirmar Consulta">Confirmar</button>` : ''}
                  <button class="btn tiny danger" name="status" value="cancelled" title="Cancelar Consulta">Cancelar</button>
                </form>` : '<span class="muted" style="font-size:0.8rem">Cancelada</span>'}
              </div>
            </td>
          </tr>
        `;
      }
    )
    .join('');

  const appointmentsSectionHtml = `
    <section class="panel" id="agenda">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0">Consultas Agendadas</h2>
        <a class="btn tiny primary" href="/admin/agenda">+ Marcar Consulta na Agenda</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Título</th>
              <th>Valor</th>
              <th>Observações</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${appointmentsRows || '<tr><td colspan="5" class="muted">Nenhuma consulta marcada para esta paciente.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Modal de Edição de Agendamento na Pasta da Paciente -->
    <div class="appt-modal-overlay" id="patientApptModalOverlay" onclick="closePatientApptModal()" style="display:none"></div>
    <div class="appt-modal" id="patientApptModal" style="display:none">
      <div class="appt-modal-header">
        <div>
          <h3 style="margin:0;font-size:1.1rem">Editar Consulta Agendada</h3>
          <p class="muted" style="margin:4px 0 0;font-size:0.82rem">Paciente: <strong>${escapeHtml(patient.full_name)}</strong></p>
        </div>
        <button class="btn ghost" type="button" onclick="closePatientApptModal()">✕</button>
      </div>

      <form class="form-stack" method="post" id="patientApptEditForm" action="">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <input type="hidden" name="returnPatient" value="${patient.id}">
        <input type="hidden" name="startDate" id="pEditStartDate">
        <input type="hidden" name="startTime" id="pEditStartTime">
        <input type="hidden" name="endDate" id="pEditEndDate">
        <input type="hidden" name="endTime" id="pEditEndTime">

        <label class="field">
          <span>Título / Procedimento *</span>
          <input type="text" name="title" id="pEditTitle" required>
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">
            <span>Data de Início *</span>
            <input type="date" id="pInputStartDate" required onchange="document.getElementById('pEditStartDate').value=this.value">
          </label>
          <label class="field">
            <span>Horário de Início *</span>
            <input type="time" id="pInputStartTime" required onchange="document.getElementById('pEditStartTime').value=this.value">
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">
            <span>Data de Término (opcional)</span>
            <input type="date" id="pInputEndDate" onchange="document.getElementById('pEditEndDate').value=this.value">
          </label>
          <label class="field">
            <span>Horário de Término (opcional)</span>
            <input type="time" id="pInputEndTime" onchange="document.getElementById('pEditEndTime').value=this.value">
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">
            <span>Valor Cobrado (R$)</span>
            <input type="number" step="0.01" min="0" name="value" id="pEditValue" placeholder="0,00">
          </label>
          <label class="field">
            <span>Status da Consulta</span>
            <select name="status" id="pEditStatus">
              <option value="scheduled">Agendada</option>
              <option value="confirmed">Confirmada</option>
              <option value="completed">Realizada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Observações da Consulta</span>
          <textarea name="notes" id="pEditNotes" rows="3" placeholder="Orientações ou notas sobre a consulta..."></textarea>
        </label>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
          <button type="button" class="btn" onclick="closePatientApptModal()">Cancelar</button>
          <button type="submit" class="btn primary">💾 Salvar Alterações</button>
        </div>
      </form>
    </div>
  `;

  const aiMessagesHtml = (() => {
    if (!aiMessages.length) return '<p class="muted">Nenhuma conversa ou análise clínica gerada ainda.</p>';
    return aiMessages.map((msg) => {
      const isAi = msg.role === 'assistant';
      const contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br>');
      return `
        <div class="ai-bubble ${isAi ? 'ai-bubble--ai' : 'ai-bubble--user'}">
          <span class="ai-bubble-label">${isAi ? '🤖 IA Clínica' : '👩‍⚕️ Fran'}</span>
          <div class="ai-bubble-text">${contentHtml}</div>
          <span class="ai-bubble-time">${escapeHtml(new Date(msg.created_at).toLocaleString('pt-BR'))}</span>
        </div>
      `;
    }).join('');
  })();

  const aiSectionHtml = `
    <section class="panel" id="ia">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h2 style="margin:0">Análise da IA & Suporte Clínico</h2>
        <a class="btn primary" href="/admin/chat?patientId=${patient.id}">Abrir Chat com IA sobre esta paciente →</a>
      </div>
      <div class="ai-messages-wrap">
        ${aiMessagesHtml}
      </div>
    </section>
  `;

  // WhatsApp direto para a paciente
  const patientWaLink = toWhatsAppLink(patient.phone, `Olá ${patient.full_name}!`);

  const body = `
    <!-- Top Hero da Pasta da Paciente -->
    <header class="patient-folder-hero">
      <div class="patient-folder-meta">
        <div class="patient-avatar-code">
          ${escapeHtml(toCodeNumber(patient.patient_code))}
        </div>
        <div>
          <p class="eyebrow" style="margin:0 0 4px">Pasta da Paciente</p>
          <h1 class="patient-folder-title">${escapeHtml(patient.full_name)}</h1>
          <div class="patient-contact-line">
            ${patient.phone ? `
              <span>📱 Telefone/Whats: <strong>${escapeHtml(patient.phone)}</strong></span>
            ` : ''}
            ${patient.email ? `
              <span>✉️ E-mail: <strong>${escapeHtml(patient.email)}</strong></span>
            ` : ''}
            <span>🗓️ Cadastro: ${escapeHtml(new Date(patient.created_at).toLocaleDateString('pt-BR'))}</span>
          </div>
        </div>
      </div>

      <div class="quick-actions-bar">
        ${patientWaLink ? `
          <a class="btn whatsapp" href="${escapeHtml(patientWaLink)}" target="_blank" rel="noopener">
            📲 WhatsApp
          </a>
        ` : ''}
        <a class="btn" href="#anamnese">📋 Anamnese</a>
        <a class="btn" href="#galeria">📸 Galeria</a>
        <a class="btn" href="#evolucoes">📝 Prontuário</a>
        <a class="btn" href="#termos">✍️ Termos</a>
        <a class="btn" href="#financeiro">💰 Financeiro</a>
        <a class="btn primary" href="/admin/chat?patientId=${patient.id}">🤖 Chat IA</a>
      </div>
    </header>

    <!-- Alertas de Sucesso/Erro -->
    ${renderAlert(req.query.saved_evolution ? 'Evolução clínica salva no prontuário com sucesso!' : null, 'success')}
    ${renderAlert(req.query.updated_evolution ? 'Evolução clínica atualizada com sucesso!' : null, 'success')}
    ${renderAlert(req.query.deleted_evolution ? 'Evolução clínica removida.' : null, 'info')}
    ${renderAlert(req.query.uploaded_media ? 'Fotos salvas na galeria clínica com sucesso!' : null, 'success')}
    ${renderAlert(req.query.deleted_media ? 'Foto removida da galeria.' : null, 'info')}
    ${renderAlert(req.query.issued_consent ? 'Termo de consentimento emitido! Envie o link para a paciente assinar no celular.' : null, 'success')}
    ${renderAlert(req.query.deleted_consent ? 'Termo de consentimento removido.' : null, 'info')}
    ${renderAlert(req.query.saved_financial ? 'Registro financeiro do procedimento salvo com sucesso!' : null, 'success')}
    ${renderAlert(req.query.deleted_financial ? 'Registro financeiro removido.' : null, 'info')}
    ${renderAlert(req.query.new_link ? 'Novo link de anamnese gerado com sucesso!' : null, 'success')}
    ${renderAlert(req.query.updated_appt ? 'Consulta agendada atualizada com sucesso!' : null, 'success')}
    ${renderAlert(req.query.error || null, 'error')}

    <!-- 1. Ficha de Anamnese (Topo) -->
    ${anamneseSectionHtml}

    <!-- 2. Galeria Clínica: Marcações, Antes & Depois (Meio) -->
    ${galleryHtml}

    <!-- 3. Prontuário & Evoluções Clínicas ("Infinito" e Editável) -->
    ${evolutionsSectionHtml}

    <!-- 4. Termos de Consentimento por Procedimento -->
    ${consentSectionHtml}

    <!-- 5. Tabela e Calculadora Financeira de Rentabilidade -->
    ${financialSectionHtml}

    <!-- 6. Agenda & IA -->
    ${appointmentsSectionHtml}
    ${aiSectionHtml}

    <!-- Lightbox Modal para Visualização de Imagens -->
    <div class="lightbox-backdrop" id="lightboxModal" onclick="closeLightbox()">
      <div class="lightbox-content" onclick="event.stopPropagation()">
        <button class="lightbox-close" onclick="closeLightbox()">✕</button>
        <img id="lightboxImg" src="" alt="Imagem ampliada">
      </div>
    </div>

    <!-- Script da Calculadora Financeira e Lightbox -->
    <script>
      function openLightbox(url) {
        document.getElementById('lightboxImg').src = url;
        document.getElementById('lightboxModal').classList.add('active');
      }
      function closeLightbox() {
        document.getElementById('lightboxModal').classList.remove('active');
      }

      function handleMediaFilesSelected(input) {
        const info = document.getElementById('mediaFilesSelectedInfo');
        if (!info) return;
        if (!input.files || !input.files.length) {
          info.textContent = '';
          return;
        }
        let totalBytes = 0;
        for (let i = 0; i < input.files.length; i++) {
          totalBytes += input.files[i].size;
        }
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        info.textContent = '✅ ' + input.files.length + ' foto(s) selecionada(s) (total: ' + mb + ' MB).';
      }

      function handleMediaUploadSubmit(form) {
        const btn = document.getElementById('mediaUploadSubmitBtn');
        if (btn) {
          btn.disabled = true;
          btn.style.opacity = '0.75';
          btn.innerHTML = '⏳ Enviando fotos... por favor aguarde...';
        }
        return true;
      }

      function formatMoney(val) {
        return (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      ${renderMaterialsPickerScript('calc', 'recalcProfit')}

      function selectDirectPayment(methodCode, feePct, inst, label) {
        document.getElementById('calcPaymentMethod').value = methodCode;
        document.getElementById('calcInstallments').value = inst;
        var feeInput = document.getElementById('calcCardFeePct');
        if (feeInput) feeInput.value = feePct.toFixed(2);

        var selVM = document.getElementById('calcPayVisaMaster');
        var selElo = document.getElementById('calcPayEloAmex');
        if (selVM) { selVM.value = ''; selVM.classList.remove('has-value'); }
        if (selElo) { selElo.value = ''; selElo.classList.remove('has-value'); }

        var btnPix = document.getElementById('calcBtnPix');
        var btnDin = document.getElementById('calcBtnDinheiro');
        if (btnPix) btnPix.classList.toggle('active', methodCode === 'pix');
        if (btnDin) btnDin.classList.toggle('active', methodCode === 'dinheiro');

        var lbl = document.getElementById('calcSelectedPaymentLabel');
        if (lbl) lbl.textContent = 'Selecionado: ' + label + ' (0%)';

        recalcProfit();
      }

      function selectBrandOption(selectElem, brand) {
        if (!selectElem.value) return;
        var opt = selectElem.options[selectElem.selectedIndex];
        var fee = parseFloat(opt.dataset.fee) || 0;
        var inst = parseInt(opt.dataset.installments) || 1;
        var label = opt.dataset.label || selectElem.value;

        document.getElementById('calcPaymentMethod').value = selectElem.value;
        document.getElementById('calcInstallments').value = inst;
        var feeInput = document.getElementById('calcCardFeePct');
        if (feeInput) feeInput.value = fee.toFixed(2);

        if (brand === 'visa_master') {
          var other = document.getElementById('calcPayEloAmex');
          if (other) { other.value = ''; other.classList.remove('has-value'); }
          selectElem.classList.add('has-value');
        } else {
          var other = document.getElementById('calcPayVisaMaster');
          if (other) { other.value = ''; other.classList.remove('has-value'); }
          selectElem.classList.add('has-value');
        }

        var btnPix = document.getElementById('calcBtnPix');
        var btnDin = document.getElementById('calcBtnDinheiro');
        if (btnPix) btnPix.classList.remove('active');
        if (btnDin) btnDin.classList.remove('active');

        var lbl = document.getElementById('calcSelectedPaymentLabel');
        if (lbl) lbl.textContent = 'Selecionado: ' + label + ' (' + fee.toFixed(2).replace('.', ',') + '%)';

        recalcProfit();
      }

      function openPatientApptModalFromBtn(btn) {
        try {
          var data = JSON.parse(btn.getAttribute('data-appt'));
          var form = document.getElementById('patientApptEditForm');
          form.action = '/admin/agenda/' + data.id + '/edit';
          document.getElementById('pEditTitle').value = data.title || '';
          document.getElementById('pEditValue').value = data.value || '';
          document.getElementById('pEditNotes').value = data.notes || '';
          document.getElementById('pEditStartDate').value = data.startDate || '';
          document.getElementById('pInputStartDate').value = data.startDate || '';
          document.getElementById('pEditStartTime').value = data.startTime || '';
          document.getElementById('pInputStartTime').value = data.startTime || '';
          document.getElementById('pEditEndDate').value = data.endDate || '';
          document.getElementById('pInputEndDate').value = data.endDate || '';
          document.getElementById('pEditEndTime').value = data.endTime || '';
          document.getElementById('pInputEndTime').value = data.endTime || '';
          if (data.status) {
            document.getElementById('pEditStatus').value = data.status;
          }
          document.getElementById('patientApptModal').style.display = 'block';
          document.getElementById('patientApptModalOverlay').style.display = 'block';
          document.body.style.overflow = 'hidden';
        } catch(err) {
          console.error('Erro ao abrir edição de consulta:', err);
        }
      }

      function closePatientApptModal() {
        document.getElementById('patientApptModal').style.display = 'none';
        document.getElementById('patientApptModalOverlay').style.display = 'none';
        document.body.style.overflow = '';
      }

      function recalcProfit() {
        var gross = parseFloat(document.getElementById('calcGrossValue').value) || 0;
        var extraMat = parseFloat(document.getElementById('calcExtraMaterials').value) || 0;
        var taxPct = parseFloat(document.getElementById('calcTaxPct').value) || 0;
        var cardPct = parseFloat(document.getElementById('calcCardFeePct').value) || 0;
        var clinicPct = parseFloat(document.getElementById('calcClinicSplitPct').value) || 0;

        // Soma materiais selecionados
        var catalogMatCost = 0;
        var selectedCount = 0;
        var selectedMaterials = [];
        document.querySelectorAll('.calc-mat-qty').forEach(function(input) {
          var qty = parseFloat(input.value) || 0;
          if (qty > 0) {
            var id = input.dataset.id;
            var cost = parseFloat(input.dataset.cost) || 0;
            var totalItem = qty * cost;
            var cb = document.querySelector('.calc-mat-checkbox[data-id="' + id + '"]');
            var name = cb ? cb.dataset.name : ('Item ' + id);
            catalogMatCost += totalItem;
            selectedCount++;
            selectedMaterials.push({ id: id, name: name, cost: cost, qty: qty, total: totalItem });
          }
        });

        var totalMaterials = catalogMatCost + extraMat;

        // 1. Taxa do cartão sobre o valor total
        var cardFeeAmount = gross * (cardPct / 100);
        var valueAfterCard = Math.max(0, gross - cardFeeAmount);

        // 2. Imposto de 6% sobre o valor após taxa do cartão
        var taxAmount = valueAfterCard * (taxPct / 100);
        var valueAfterTax = Math.max(0, valueAfterCard - taxAmount);

        // 3. Repasse da clínica de 30% sobre o valor após imposto
        var clinicSplitAmount = valueAfterTax * (clinicPct / 100);
        var professionalSubtotal = Math.max(0, valueAfterTax - clinicSplitAmount);

        // 4. Lucro Líquido final = Cota da Fran - materiais utilizados
        var netProfit = professionalSubtotal - totalMaterials;
        var marginPct = gross > 0 ? ((netProfit / gross) * 100).toFixed(1) : '0';

        // Atualiza campos ocultos do form
        var matJsonElem = document.getElementById('calcMaterialsJson');
        if (matJsonElem) matJsonElem.value = JSON.stringify(selectedMaterials);
        var taxElem = document.getElementById('calcTaxAmount');
        if (taxElem) taxElem.value = taxAmount.toFixed(2);
        var cardElem = document.getElementById('calcCardFeeAmount');
        if (cardElem) cardElem.value = cardFeeAmount.toFixed(2);
        var clinicElem = document.getElementById('calcClinicSplitAmount');
        if (clinicElem) clinicElem.value = clinicSplitAmount.toFixed(2);
        var netElemHidden = document.getElementById('calcNetProfitHidden');
        if (netElemHidden) netElemHidden.value = netProfit.toFixed(2);

        // Atualiza extrato visual dos 6 passos
        var liveGross = document.getElementById('liveGross');
        if (liveGross) liveGross.textContent = 'R$ ' + formatMoney(gross);

        var liveCardPct = document.getElementById('liveCardPct');
        if (liveCardPct) liveCardPct.textContent = cardPct.toFixed(2);
        var liveCardFee = document.getElementById('liveCardFee');
        if (liveCardFee) liveCardFee.textContent = '- R$ ' + formatMoney(cardFeeAmount);
        var liveAfterCard = document.getElementById('liveAfterCard');
        if (liveAfterCard) liveAfterCard.textContent = 'R$ ' + formatMoney(valueAfterCard);

        var liveTaxPct = document.getElementById('liveTaxPct');
        if (liveTaxPct) liveTaxPct.textContent = taxPct.toFixed(1);
        var liveTax = document.getElementById('liveTax');
        if (liveTax) liveTax.textContent = '- R$ ' + formatMoney(taxAmount);
        var liveAfterTax = document.getElementById('liveAfterTax');
        if (liveAfterTax) liveAfterTax.textContent = 'R$ ' + formatMoney(valueAfterTax);

        var liveClinicPct = document.getElementById('liveClinicPct');
        if (liveClinicPct) liveClinicPct.textContent = clinicPct.toFixed(1);
        var liveClinicSplit = document.getElementById('liveClinicSplit');
        if (liveClinicSplit) liveClinicSplit.textContent = '- R$ ' + formatMoney(clinicSplitAmount);
        var liveProfSubtotal = document.getElementById('liveProfSubtotal');
        if (liveProfSubtotal) liveProfSubtotal.textContent = 'R$ ' + formatMoney(professionalSubtotal);

        var liveMaterials = document.getElementById('liveMaterials');
        if (liveMaterials) liveMaterials.textContent = '- R$ ' + formatMoney(totalMaterials);
        var liveMaterialsCount = document.getElementById('liveMaterialsCount');
        if (liveMaterialsCount) liveMaterialsCount.textContent = selectedCount + ' item(ns) selecionado(s)' + (extraMat > 0 ? ' + extra' : '');

        var liveNetProfit = document.getElementById('liveNetProfit');
        if (liveNetProfit) {
          liveNetProfit.textContent = 'R$ ' + formatMoney(netProfit);
          if (netProfit < 0) {
            liveNetProfit.style.background = '#fef2f2';
            liveNetProfit.style.color = '#dc2626';
          } else {
            liveNetProfit.style.background = '#f0fdf4';
            liveNetProfit.style.color = '#15803d';
          }
        }

        var liveMarginPct = document.getElementById('liveMarginPct');
        if (liveMarginPct) liveMarginPct.textContent = 'Margem Líquida: ' + marginPct + '%';

        var methodCode = (document.getElementById('calcPaymentMethod') || {}).value || 'pix';
        var inst = parseInt((document.getElementById('calcInstallments') || {}).value) || 1;
        var liveInst = document.getElementById('liveInstallmentLabel');
        if (liveInst) {
          if (inst > 1 && gross > 0) {
            var part = gross / inst;
            liveInst.textContent = inst + 'x de R$ ' + formatMoney(part);
          } else if (methodCode === 'dinheiro') {
            liveInst.textContent = 'Dinheiro à Vista (Sem taxa)';
          } else if (methodCode === 'pix') {
            liveInst.textContent = 'Pix à Vista (Sem taxa)';
          } else if (methodCode.includes('debito')) {
            liveInst.textContent = 'Débito à Vista';
          } else {
            liveInst.textContent = '1x à vista';
          }
        }
      }

      // Inicializa cálculo
      window.addEventListener('DOMContentLoaded', function() {
        recalcProfit();
      });
    </script>
  `;

  res.send(layout({ title: `Pasta ${patient.full_name}`, body, userEmail: req.session.adminEmail, activeNav: 'patients' }));
});

// ─── ROTAS DO PRONTUÁRIO & EVOLUÇÕES ────────────────────────
app.post('/admin/patients/:id/evolutions', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const sessionDate = String(req.body.session_date || '').trim() || new Date().toISOString().slice(0, 10);
  const procedureName = String(req.body.procedure_name || '').trim() || null;
  const notes = String(req.body.notes || '').trim();

  if (!notes) {
    res.redirect(`/admin/patients/${patientId}?error=${encodeURIComponent('Preencha a anotação da consulta.')}#evolucoes`);
    return;
  }

  db.prepare(`
    INSERT INTO patient_evolutions (patient_id, procedure_name, session_date, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(patientId, procedureName, sessionDate, notes, nowIso(), nowIso());

  res.redirect(`/admin/patients/${patientId}?saved_evolution=1#evolucoes`);
});

app.post('/admin/patients/:id/evolutions/:evoId/edit', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const evoId = Number(req.params.evoId);
  const sessionDate = String(req.body.session_date || '').trim();
  const procedureName = String(req.body.procedure_name || '').trim() || null;
  const notes = String(req.body.notes || '').trim();

  db.prepare(`
    UPDATE patient_evolutions
    SET session_date = ?, procedure_name = ?, notes = ?, updated_at = ?
    WHERE id = ? AND patient_id = ?
  `).run(sessionDate, procedureName, notes, nowIso(), evoId, patientId);

  res.redirect(`/admin/patients/${patientId}?updated_evolution=1#evolucoes`);
});

app.post('/admin/patients/:id/evolutions/:evoId/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const evoId = Number(req.params.evoId);

  db.prepare('DELETE FROM patient_evolutions WHERE id = ? AND patient_id = ?').run(evoId, patientId);
  res.redirect(`/admin/patients/${patientId}?deleted_evolution=1#evolucoes`);
});

// ─── ROTAS DA GALERIA DE FOTOS (MARCAÇÕES, ANTES & DEPOIS) ──
app.post('/admin/patients/:id/media', requireAuth, (req, res) => {
  upload.array('mediaFiles', 50)(req, res, (err) => {
    if (err) {
      let errorMsg = err.message;
      if (err.code === 'LIMIT_FILE_SIZE') {
        errorMsg = 'Uma ou mais fotos ultrapassam o tamanho permitido (limite de 100 MB por imagem).';
      } else if (err.code === 'LIMIT_FILE_COUNT') {
        errorMsg = 'Número máximo de fotos por envio excedido (limite de 50 fotos por vez).';
      }
      res.redirect(`/admin/patients/${req.params.id}?error=${encodeURIComponent(errorMsg)}#galeria`);
      return;
    }
    if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }

    const patientId = Number(req.params.id);
    const category = String(req.body.category || 'geral');
    const notes = String(req.body.notes || '').trim() || null;
    const files = req.files || [];

    if (!files.length) {
      res.redirect(`/admin/patients/${patientId}?error=${encodeURIComponent('Nenhuma foto selecionada.')}#galeria`);
      return;
    }

    const insertMedia = db.prepare(`
      INSERT INTO patient_media (patient_id, category, original_name, stored_name, mime_type, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const file of files) {
        insertMedia.run(patientId, category, file.originalname, file.filename, file.mimetype || null, notes, nowIso());
      }
    });
    tx();

    res.redirect(`/admin/patients/${patientId}?uploaded_media=${files.length}#galeria`);
  });
});

app.get('/admin/media/:id', requireAuth, (req, res) => {
  const mediaId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM patient_media WHERE id = ?').get(mediaId);
  if (!item) { res.status(404).send('Imagem não encontrada.'); return; }
  const absPath = path.join(uploadDir, item.stored_name);
  if (!fs.existsSync(absPath)) { res.status(404).send('Arquivo não encontrado no disco.'); return; }

  const ext = path.extname(item.stored_name).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.pdf': 'application/pdf'
  };
  const mime = (item.mime_type && item.mime_type !== 'application/octet-stream') ? item.mime_type : (mimeMap[ext] || 'image/jpeg');
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(absPath);
});

app.post('/admin/patients/:id/media/:mediaId/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);
  const item = db.prepare('SELECT stored_name FROM patient_media WHERE id = ? AND patient_id = ?').get(mediaId, patientId);
  if (item) {
    db.prepare('DELETE FROM patient_media WHERE id = ?').run(mediaId);
    try { fs.unlinkSync(path.join(uploadDir, item.stored_name)); } catch (_e) {}
  }
  res.redirect(`/admin/patients/${patientId}?deleted_media=1#galeria`);
});

// ─── ROTAS DE TERMOS DE CONSENTIMENTO (TCLE) ────────────────
app.post('/admin/patients/:id/consents', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const templateId = Number(req.body.templateId || req.body.template_id || 0) || null;
  let procedureName = String(req.body.procedureName || req.body.procedure_name || '').trim();
  if (!procedureName && templateId) {
    const tpl = db.prepare('SELECT procedure_name FROM consent_templates WHERE id = ?').get(templateId);
    if (tpl) procedureName = tpl.procedure_name;
  }
  if (!procedureName) procedureName = 'Procedimento Estético';
  const token = crypto.randomBytes(18).toString('hex');

  db.prepare(`
    INSERT INTO patient_consents (patient_id, template_id, token, procedure_name, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(patientId, templateId, token, procedureName, nowIso());

  res.redirect(`/admin/patients/${patientId}?issued_consent=${encodeURIComponent(token)}#termos`);
});

app.post('/admin/patients/:id/consents/:consentId/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const consentId = Number(req.params.consentId);
  db.prepare('DELETE FROM patient_consents WHERE id = ? AND patient_id = ?').run(consentId, patientId);
  res.redirect(`/admin/patients/${patientId}?deleted_consent=1#termos`);
});

// Visualização / Impressão de Termo Assinado
app.get('/admin/consents/:id', requireAuth, (req, res) => {
  const consentId = Number(req.params.id);
  const consent = db.prepare(`
    SELECT pc.*, p.full_name as patient_name, p.patient_code, p.email, p.phone, ct.content as template_content
    FROM patient_consents pc
    JOIN patients p ON p.id = pc.patient_id
    LEFT JOIN consent_templates ct ON ct.id = pc.template_id
    WHERE pc.id = ?
  `).get(consentId);

  if (!consent) { res.status(404).send('Termo não encontrado.'); return; }

  const text = (consent.template_content || '')
    .replace(/\{\{NOME_PACIENTE\}\}/g, consent.patient_name || 'Paciente')
    .replace(/\{\{DATA\}\}/g, new Date().toLocaleDateString('pt-BR'));

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Termo de Consentimento — ${escapeHtml(consent.procedure_name)}</title>
      <style>
        @page { margin: 15mm 18mm; size: A4; }
        body { font-family: 'Georgia', serif; color: #18261e; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 24px; background: #fff; }
        .doc-header { background: #1c3f2d; color: #fff; border-radius: 10px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border: 1px solid #d4be88; }
        .doc-header-left { display: flex; align-items: center; gap: 14px; }
        .doc-logo { width: 48px; height: 48px; object-fit: contain; }
        .doc-title { margin: 0; font-family: Georgia, serif; font-size: 1.3rem; letter-spacing: 0.08em; color: #e2c275; text-transform: uppercase; font-weight: bold; }
        .doc-sub { margin: 2px 0 0; font-size: 0.75rem; letter-spacing: 0.1em; color: #f7f5f0; opacity: 0.9; text-transform: uppercase; }
        .doc-meta-right { text-align: right; font-size: 0.8rem; color: #e2c275; border-left: 1px solid rgba(226, 194, 117, 0.4); padding-left: 14px; }
        .doc-meta-right strong { color: #fff; }
        .pill-title { display: inline-block; background: #f4efe7; border: 1px solid #d4be88; color: #1c3f2d; padding: 6px 14px; border-radius: 999px; font-weight: bold; font-size: 0.9rem; margin-bottom: 14px; }
        .meta-box { background: #fdfbf7; border: 1px solid #ded6ca; border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; font-size: 0.88rem; line-height: 1.6; }
        .term-body { white-space: pre-wrap; font-size: 0.92rem; line-height: 1.65; margin: 20px 0; color: #232d26; }
        .signatures-grid { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; align-items: end; page-break-inside: avoid; }
        .sig-block { border-top: 2px solid #1c3f2d; padding-top: 10px; font-size: 0.86rem; }
        @media print { .no-print { display: none !important; } body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc-header">
        <div class="doc-header-left">
          <img src="/public/logo-fh.png" alt="Dra. Fran Hanel" class="doc-logo">
          <div>
            <div class="doc-title">Dra. Fransuele Hanel</div>
            <div class="doc-sub">Biomedicina Estética Avançada & Integrativa</div>
          </div>
        </div>
        <div class="doc-meta-right">
          <div>CRBM-5: <strong>015427</strong></div>
          <div>Prontuário: <strong>#${escapeHtml(toCodeNumber(consent.patient_code))}</strong></div>
        </div>
      </div>

      <div class="pill-title">TCLE • ${escapeHtml(consent.procedure_name)}</div>

      <div class="meta-box">
        <strong>Paciente:</strong> ${escapeHtml(consent.patient_name)} (${escapeHtml(toCodeNumber(consent.patient_code))})<br>
        <strong>Telefone / WhatsApp:</strong> ${escapeHtml(consent.phone || '-')} · <strong>E-mail:</strong> ${escapeHtml(consent.email || '-')}<br>
        <strong>Status:</strong> ${consent.status === 'signed' ? '✅ Assinado digitalmente' : '⏳ Aguardando assinatura da paciente'}<br>
        ${consent.signed_at ? `<strong>Data/Hora da Assinatura:</strong> ${escapeHtml(new Date(consent.signed_at).toLocaleString('pt-BR'))} · <strong>IP do Dispositivo:</strong> ${escapeHtml(consent.client_ip || '-')}` : ''}
        ${consent.notes ? `<br><strong>${escapeHtml(consent.notes)}</strong>` : ''}
      </div>

      <div class="term-body">${escapeHtml(text)}</div>

      <div class="signatures-grid">
        <div class="sig-block">
          ${consent.signature_data ? `
            <img src="${escapeHtml(consent.signature_data)}" alt="Assinatura da Paciente" style="max-height:75px;display:block;margin-bottom:6px">
          ` : '<div style="height:50px"></div>'}
          <strong>${escapeHtml(consent.signed_name || consent.patient_name)}</strong><br>
          <span style="font-size:0.78rem;color:#666">Assinatura do(a) Paciente ou Responsável Legal</span>
          ${consent.signed_at ? `<br><span style="font-size:0.75rem;color:#888">Certificado Digitalmente em ${escapeHtml(new Date(consent.signed_at).toLocaleString('pt-BR'))}</span>` : ''}
        </div>

        <div class="sig-block">
          <div style="height:50px;display:flex;align-items:flex-end">
            <span style="font-family:'Cinzel',Georgia,serif;color:#1c3f2d;font-weight:bold;font-size:1.05rem">Dra. Fransuele Hanel</span>
          </div>
          <strong>Dra. Fransuele Hanel — CRBM-5 015427</strong><br>
          <span style="font-size:0.78rem;color:#666">Biomedicina Estética Avançada & Integrativa</span>
        </div>
      </div>

      <div class="no-print" style="margin-top:34px;text-align:center">
        <button onclick="window.print()" style="padding:12px 28px;background:#1c3f2d;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;box-shadow:0 4px 14px rgba(28,63,45,0.3)">
          🖨️ Imprimir / Salvar em PDF
        </button>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

// ─── ROTAS DO FINANCEIRO & RENTABILIDADE POR PACIENTE ───────
app.post('/admin/patients/:id/financial', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const description = String(req.body.description || '').trim() || 'Procedimento Realizado';
  const grossValue = parseFloat(req.body.gross_value) || 0;
  const extraMaterials = parseFloat(req.body.extra_materials) || 0;
  const paymentMethod = String(req.body.payment_method || 'pix').trim();
  const installments = Math.max(1, parseInt(req.body.installments) || 1);
  const taxPct = parseFloat(req.body.tax_pct) || 0;
  const cardFeePct = parseFloat(req.body.card_fee_pct) || 0;
  const clinicSplitPct = parseFloat(req.body.clinic_split_pct) || 0;

  const materialsJson = String(req.body.materials_json || '[]');
  let catalogMatCost = 0;
  try {
    const list = JSON.parse(materialsJson);
    catalogMatCost = list.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  } catch (_e) {}

  const materialsCost = catalogMatCost + extraMaterials;
  const calc = calculateProcedureProfit({
    grossValue,
    cardFeePct,
    taxPct,
    clinicSplitPct,
    materialsCost
  });

  db.prepare(`
    INSERT INTO procedure_financials (
      patient_id, description, payment_method, installments,
      gross_value, materials_cost, materials_json,
      card_fee_pct, card_fee_amount, value_after_card,
      tax_pct, tax_amount, value_after_tax,
      clinic_split_pct, clinic_split_amount, professional_subtotal,
      net_profit, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId, description, paymentMethod, installments,
    calc.grossValue, calc.materialsCost, materialsJson,
    calc.cardFeePct, calc.cardFeeAmount, calc.valueAfterCard,
    calc.taxPct, calc.taxAmount, calc.valueAfterTax,
    calc.clinicSplitPct, calc.clinicSplitAmount, calc.professionalSubtotal,
    calc.netProfit, nowIso()
  );

  res.redirect(`/admin/patients/${patientId}?saved_financial=1#financeiro`);
});

app.post('/admin/patients/:id/financial/:entryId/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const entryId = Number(req.params.entryId);
  db.prepare('DELETE FROM procedure_financials WHERE id = ? AND patient_id = ?').run(entryId, patientId);
  res.redirect(`/admin/patients/${patientId}?deleted_financial=1#financeiro`);
});

// Gerar novo link de anamnese avulso a partir da pasta da paciente
app.post('/admin/patients/:id/generate-link', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.params.id);
  const patient = db.prepare('SELECT full_name, email FROM patients WHERE id = ?').get(patientId);
  const token = crypto.randomBytes(18).toString('hex');

  db.prepare(`
    INSERT INTO patient_links (token, patient_id, patient_name_hint, patient_email_hint, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, patientId, patient?.full_name || null, patient?.email || null, nowIso());

  res.redirect(`/admin/patients/${patientId}?new_link=${encodeURIComponent(token)}#anamnese`);
});

app.get('/admin/agenda', requireAuth, (req, res) => {
  const monthDate = parseMonthQuery(String(req.query.month || ''));
  const monthKey = monthKeyFromDate(monthDate);
  const prevMonthKey = monthKeyFromDate(previousMonth(monthDate));
  const nextMonthKey = monthKeyFromDate(nextMonth(monthDate));
  const monthLabel = monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const appointments = db
    .prepare(
      `
      SELECT
        a.*,
        p.full_name,
        p.patient_code,
        p.notes AS patient_notes
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patient_id
      WHERE substr(a.start_at, 1, 7) = ?
        AND a.status != 'cancelled'
      ORDER BY a.start_at ASC
      `
    )
    .all(monthKey);

  const patients = db
    .prepare('SELECT id, patient_code, full_name FROM patients ORDER BY id ASC')
    .all();

  const eventsByDay = new Map();
  for (const item of appointments) {
    const key = String(item.start_at || '').slice(0, 10);
    if (!eventsByDay.has(key)) {
      eventsByDay.set(key, []);
    }
    eventsByDay.get(key).push(item);
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  const calendarCells = buildMonthGrid(monthDate)
    .map((cell) => {
      if (!cell) {
        return '<article class="calendar-cell empty"></article>';
      }

      const events = eventsByDay.get(cell.dateKey) || [];
      const isToday = cell.dateKey === todayKey;

      const eventsHtml = events
        .map((event) => {
          const statusBadge = event.status === 'confirmed'
            ? '<span class="chip done" style="font-size:0.68rem;padding:1px 6px;">Confirmada</span>'
            : '<span class="chip pending" style="font-size:0.68rem;padding:1px 6px;">Agendada</span>';

          const startParts = String(event.start_at || '').slice(0, 16).split('T');
          const endParts  = String(event.end_at  || '').slice(0, 16).split('T');

          // Dados do agendamento como data-attribute (JSON seguro, sem aspas duplas no atributo)
          const apptJson = JSON.stringify({
            id: event.id,
            title: event.title || '',
            patientId: event.patient_id || null,
            patientName: event.full_name || '',
            patientNotes: event.patient_notes || '',
            startDate: startParts[0] || '',
            startTime: (startParts[1] || '').slice(0, 5),
            endDate: endParts[0] || '',
            endTime: (endParts[1] || '').slice(0, 5),
            notes: event.notes || '',
            status: event.status || 'scheduled',
            value: event.value != null ? String(event.value) : ''
          }).replace(/'/g, '&#39;');

          return `
            <div class="calendar-event-block">
              <div class="calendar-event-info" data-appt='${apptJson}'
                title="${escapeHtml(event.notes || '')}">
                <span class="evt-time">${escapeHtml(formatTime(event.start_at))}</span>
                ${event.patient_id
                  ? `<a class="evt-name" href="/admin/patients/${event.patient_id}" onclick="event.stopPropagation()">
                      <strong>${escapeHtml(toCodeNumber(event.patient_code))}</strong> ${escapeHtml(event.full_name)}
                    </a>`
                  : `<span class="evt-name"><strong>${escapeHtml(event.title)}</strong></span>`}
                ${statusBadge}
                ${event.value != null ? `<span class="appointment-value">R$ ${escapeHtml(formatBRL(event.value))}</span>` : ''}
              </div>
              <div style="display:inline-flex;gap:3px;align-items:center">
                <button class="btn tiny" type="button" onclick="event.stopPropagation(); window.openApptModal(JSON.parse(this.closest('.calendar-event-block').querySelector('.calendar-event-info').dataset.appt))" title="Editar Agendamento">✏️</button>
                ${event.status !== 'cancelled' ? `
                <form method="post" action="/admin/agenda/${event.id}/status" style="display:inline">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <input type="hidden" name="returnMonth" value="${escapeHtml(monthKey)}">
                  ${event.status !== 'confirmed' ? `<button class="btn tiny" name="status" value="confirmed" title="Confirmar">✓</button>` : ''}
                  <button class="btn tiny danger" name="status" value="cancelled" title="Cancelar">✗</button>
                </form>` : ''}
              </div>
            </div>`;
        })
        .join('');

      const hasEvents = events.length > 0;
      return `
        <article class="calendar-cell${hasEvents ? ' has-events' : ''}${isToday ? ' is-today' : ''}">
          <header class="calendar-day-num">${cell.day}</header>
          <div class="calendar-events">
            ${eventsHtml || '<span class="muted" style="font-size:0.78rem">—</span>'}
          </div>
        </article>
      `;
    })
    .join('');

  const patientOptions = patients
    .map(
      (patient) =>
        `<option value="${patient.id}">${escapeHtml(toCodeNumber(patient.patient_code))} - ${escapeHtml(patient.full_name)}</option>`
    )
    .join('');

  let anamneseAlertHtml = '';
  if (req.query.newAnamneseToken) {
    const token = String(req.query.newAnamneseToken);
    const pId = Number(req.query.newPatientId || 0);
    const pat = pId ? db.prepare('SELECT * FROM patients WHERE id = ?').get(pId) : null;
    const anamneseUrl = `${BASE_URL}/paciente/${token}`;
    const pName = pat ? pat.full_name : 'Paciente';
    const pPhone = pat ? pat.phone : '';
    const msg = `Olá ${pName}! Confirmamos o seu agendamento. Para prepararmos sua consulta da melhor forma, por favor preencha sua ficha de anamnese neste link: ${anamneseUrl}`;
    const waLink = toWhatsAppLink(pPhone, msg);

    anamneseAlertHtml = `
      <div class="panel" style="border:2px solid #25d366;background:#f0fdf4;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 6px;color:#15803d;font-size:1.15rem">✅ Consulta agendada com sucesso!</h3>
            <p style="margin:0 0 10px;font-size:0.92rem;color:#166534">
              Ficha de Anamnese criada para <strong>${escapeHtml(pName)}</strong>${pPhone ? ` (${escapeHtml(pPhone)})` : ''}.
            </p>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
              <input type="text" readonly value="${escapeHtml(anamneseUrl)}" id="newAnamneseInput" style="padding:7px 12px;width:340px;border-radius:8px;border:1px solid #86efac;background:#fff;font-size:0.85rem">
              <button type="button" class="btn tiny" onclick="navigator.clipboard.writeText(document.getElementById('newAnamneseInput').value);this.textContent='Copiado!';setTimeout(()=>this.textContent='Copiar link',2000)">Copiar link</button>
              ${waLink ? `<a class="btn tiny whatsapp" href="${escapeHtml(waLink)}" target="_blank" rel="noopener">📲 Enviar no WhatsApp da Paciente</a>` : ''}
              ${pat ? `<a class="btn tiny gold" href="/admin/patients/${pat.id}">📂 Abrir Pasta da Paciente</a>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Agenda clínica</p>
        <h1>Calendário de consultas</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
        <a class="btn" href="/admin/patients">Pacientes</a>
      </div>
    </header>

    ${anamneseAlertHtml}
    ${renderAlert(req.query.created && !req.query.newAnamneseToken ? 'Consulta agendada com sucesso.' : null, 'success')}
    ${renderAlert(req.query.error || null, 'error')}

    <section class="panel">
      <div class="calendar-nav">
        <a class="btn" href="/admin/agenda?month=${escapeHtml(prevMonthKey)}">Mês anterior</a>
        <h2>${escapeHtml(monthLabel)}</h2>
        <a class="btn" href="/admin/agenda?month=${escapeHtml(nextMonthKey)}">Próximo mês</a>
      </div>
      <div class="calendar-weekdays">
        <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span>
      </div>
      <div class="calendar-grid">
        ${calendarCells}
      </div>
    </section>

    <!-- Modal de edição de agendamento -->
    <div class="appt-modal-overlay" id="apptModalOverlay" onclick="closeApptModal()" style="display:none"></div>
    <div class="appt-modal" id="apptModal" style="display:none">
      <div class="appt-modal-header">
        <div>
          <h3 id="modalPatientName" style="margin:0;font-size:1.1rem"></h3>
          <p class="muted" id="modalPatientNameSub" style="margin:4px 0 0;font-size:0.82rem"></p>
        </div>
        <button class="btn ghost" type="button" onclick="closeApptModal()">✕</button>
      </div>

      <!-- Observações clínicas da paciente (somente leitura) -->
      <div id="modalPatientNotesWrap" style="display:none;margin-bottom:16px;padding:12px 14px;background:rgba(173,95,66,0.07);border-radius:11px;border-left:3px solid var(--accent)">
        <p class="muted" style="font-size:0.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:0 0 5px">📋 Observações clínicas</p>
        <p id="modalPatientNotes" style="margin:0;font-size:0.88rem;white-space:pre-wrap"></p>
      </div>

      <form class="form-stack" method="post" id="apptEditForm" action="">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <input type="hidden" name="returnMonth" value="${escapeHtml(monthKey)}">
        <!-- Hidden fields enviados ao server -->
        <input type="hidden" name="startDate" id="editStartDate">
        <input type="hidden" name="startTime" id="editStartTime">
        <input type="hidden" name="endDate"   id="editEndDate">
        <input type="hidden" name="endTime"   id="editEndTime">

        <label class="field">
          <span>Título / tipo de consulta</span>
          <input type="text" name="title" id="editTitle" required>
        </label>

        <div class="field">
          <span>Data de início</span>
          <div class="ios-picker-row">
            <select id="selStartDay"   class="ios-select"></select>
            <select id="selStartMonth" class="ios-select">
              <option value="01">Janeiro</option><option value="02">Fevereiro</option>
              <option value="03">Março</option><option value="04">Abril</option>
              <option value="05">Maio</option><option value="06">Junho</option>
              <option value="07">Julho</option><option value="08">Agosto</option>
              <option value="09">Setembro</option><option value="10">Outubro</option>
              <option value="11">Novembro</option><option value="12">Dezembro</option>
            </select>
            <select id="selStartYear" class="ios-select"></select>
          </div>
        </div>

        <div class="field">
          <span>Horário de início</span>
          <div class="ios-picker-row ios-picker-time">
            <select id="selStartHour"   class="ios-select"></select>
            <span style="font-size:1.2rem;font-weight:700;align-self:center">:</span>
            <select id="selStartMinute" class="ios-select"></select>
          </div>
        </div>

        <div class="field">
          <span>Data de fim <span class="muted" style="font-size:0.8rem">(opcional)</span></span>
          <div class="ios-picker-row">
            <select id="selEndDay"   class="ios-select"><option value="">—</option></select>
            <select id="selEndMonth" class="ios-select">
              <option value="">—</option>
              <option value="01">Janeiro</option><option value="02">Fevereiro</option>
              <option value="03">Março</option><option value="04">Abril</option>
              <option value="05">Maio</option><option value="06">Junho</option>
              <option value="07">Julho</option><option value="08">Agosto</option>
              <option value="09">Setembro</option><option value="10">Outubro</option>
              <option value="11">Novembro</option><option value="12">Dezembro</option>
            </select>
            <select id="selEndYear" class="ios-select"><option value="">—</option></select>
          </div>
        </div>

        <div class="field">
          <span>Horário de fim <span class="muted" style="font-size:0.8rem">(opcional)</span></span>
          <div class="ios-picker-row ios-picker-time">
            <select id="selEndHour"   class="ios-select"><option value="">—</option></select>
            <span style="font-size:1.2rem;font-weight:700;align-self:center">:</span>
            <select id="selEndMinute" class="ios-select"><option value="">—</option></select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">
            <span>Valor (R$)</span>
            <input type="number" name="value" id="editValue" min="0" step="0.01" placeholder="0,00">
          </label>
          <label class="field">
            <span>Status da Consulta</span>
            <select name="status" id="editStatus">
              <option value="scheduled">Agendada</option>
              <option value="confirmed">Confirmada</option>
              <option value="completed">Realizada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Observações do agendamento</span>
          <textarea name="notes" id="editNotes" rows="3" placeholder="Ex.: trazer exames, revisar retinol…"></textarea>
        </label>

        <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:4px">
          <button class="btn" type="button" onclick="closeApptModal()">Cancelar</button>
          <button class="btn primary" type="submit">Salvar alterações</button>
        </div>
      </form>
    </div>

    <script>
    (function() {
      const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

      function fillDays(selId, selected) {
        const sel = document.getElementById(selId);
        sel.innerHTML = '';
        for (let d = 1; d <= 31; d++) {
          const o = document.createElement('option');
          o.value = String(d).padStart(2, '0');
          o.textContent = d;
          if (String(d).padStart(2,'0') === selected) o.selected = true;
          sel.appendChild(o);
        }
      }

      function fillYears(selId, selected, optional) {
        const sel = document.getElementById(selId);
        sel.innerHTML = '';
        if (optional) { const o = document.createElement('option'); o.value=''; o.textContent='—'; sel.appendChild(o); }
        const cur = new Date().getFullYear();
        for (let y = cur - 1; y <= cur + 4; y++) {
          const o = document.createElement('option');
          o.value = String(y);
          o.textContent = String(y);
          if (String(y) === selected) o.selected = true;
          sel.appendChild(o);
        }
      }

      function fillHours(selId, selected, optional) {
        const sel = document.getElementById(selId);
        sel.innerHTML = '';
        if (optional) { const o = document.createElement('option'); o.value=''; o.textContent='—'; sel.appendChild(o); }
        for (let h = 0; h <= 23; h++) {
          const v = String(h).padStart(2,'0');
          const o = document.createElement('option');
          o.value = v; o.textContent = v;
          if (v === selected) o.selected = true;
          sel.appendChild(o);
        }
      }

      function fillMinutes(selId, selected, optional) {
        const sel = document.getElementById(selId);
        sel.innerHTML = '';
        if (optional) { const o = document.createElement('option'); o.value=''; o.textContent='—'; sel.appendChild(o); }
        for (let m = 0; m < 60; m += 5) {
          const v = String(m).padStart(2,'0');
          const o = document.createElement('option');
          o.value = v; o.textContent = v;
          if (v === selected) o.selected = true;
          sel.appendChild(o);
        }
      }

      // Delega cliques nos blocos de agendamento via data-appt
      document.addEventListener('click', function(e) {
        const el = e.target.closest('.calendar-event-info');
        if (el && el.dataset.appt) {
          try {
            const data = JSON.parse(el.getAttribute('data-appt'));
            window.openApptModal(data);
          } catch(err) { console.error('appt parse error', err); }
        }
      });

      window.openApptModal = function(data) {
        // Cabeçalho
        const nameEl = document.getElementById('modalPatientName');
        const subEl  = document.getElementById('modalPatientNameSub');
        nameEl.textContent = data.patientName || data.title || 'Agendamento';
        subEl.textContent  = data.patientName ? data.title : '';

        // Observações clínicas da paciente
        const notesWrap = document.getElementById('modalPatientNotesWrap');
        const notesEl   = document.getElementById('modalPatientNotes');
        if (data.patientNotes) {
          notesEl.textContent  = data.patientNotes;
          notesWrap.style.display = 'block';
        } else {
          notesWrap.style.display = 'none';
        }

        // Título, valor e status
        document.getElementById('editTitle').value = data.title || '';
        document.getElementById('editValue').value = data.value || '';
        document.getElementById('editNotes').value = data.notes || '';
        if (data.status && document.getElementById('editStatus')) {
          document.getElementById('editStatus').value = data.status;
        }

        // Seletores de data/hora início
        const [sy, sm, sd] = (data.startDate || '').split('-');
        const [sh, smin]   = (data.startTime || '00:00').split(':');
        const nearMin = String(Math.round((parseInt(smin||0))/5)*5).padStart(2,'0') === '60' ? '55' : String(Math.round((parseInt(smin||0))/5)*5).padStart(2,'0');

        fillDays('selStartDay', sd || '01');
        fillYears('selStartYear', sy, false);
        fillHours('selStartHour', sh || '08', false);
        fillMinutes('selStartMinute', nearMin || '00', false);
        if (sm) document.getElementById('selStartMonth').value = sm;

        // Seletores de data/hora fim
        const [ey, em, ed] = (data.endDate || '').split('-');
        const [eh, emin]   = (data.endTime  || '').split(':');
        fillDays('selEndDay', ed || '01');
        fillYears('selEndYear', ey || '', true);
        fillHours('selEndHour', eh || '', true);
        fillMinutes('selEndMinute', emin || '', true);
        if (em) document.getElementById('selEndMonth').value = em;
        else    document.getElementById('selEndMonth').value = '';

        document.getElementById('apptEditForm').action = '/admin/agenda/' + data.id + '/edit';
        document.getElementById('apptModal').style.display = 'block';
        document.getElementById('apptModalOverlay').style.display = 'block';
        document.body.style.overflow = 'hidden';
      };

      window.closeApptModal = function() {
        document.getElementById('apptModal').style.display = 'none';
        document.getElementById('apptModalOverlay').style.display = 'none';
        document.body.style.overflow = '';
      };

      // Combina selects → hidden inputs antes de submeter
      document.getElementById('apptEditForm').addEventListener('submit', function() {
        const sd = document.getElementById('selStartDay').value;
        const sm = document.getElementById('selStartMonth').value;
        const sy = document.getElementById('selStartYear').value;
        const sh = document.getElementById('selStartHour').value;
        const sn = document.getElementById('selStartMinute').value;
        document.getElementById('editStartDate').value = sy && sm && sd ? sy+'-'+sm+'-'+sd : '';
        document.getElementById('editStartTime').value = sh && sn ? sh+':'+sn : '';

        const ed = document.getElementById('selEndDay').value;
        const em = document.getElementById('selEndMonth').value;
        const ey = document.getElementById('selEndYear').value;
        const eh = document.getElementById('selEndHour').value;
        const en = document.getElementById('selEndMinute').value;
        document.getElementById('editEndDate').value = ey && em && ed ? ey+'-'+em+'-'+ed : '';
        document.getElementById('editEndTime').value = eh && en ? eh+':'+en : '';
      });

      // Funções de busca rápida de paciente para marcação de consulta
      window.onPatientDatalistInput = function(input) {
        var val = (input.value || '').trim();
        var sel = document.getElementById('agendaPatientSelect');
        if (!val) {
          if (sel) sel.value = '';
          return;
        }
        var datalist = document.getElementById('agendaPatientsDatalist');
        if (datalist && sel) {
          var opts = datalist.querySelectorAll('option');
          for (var i = 0; i < opts.length; i++) {
            if (opts[i].value.toLowerCase() === val.toLowerCase()) {
              sel.value = opts[i].dataset.id;
              return;
            }
          }
        }
      };

      window.onPatientDatalistChange = function(input) {
        var val = (input.value || '').trim();
        var sel = document.getElementById('agendaPatientSelect');
        if (!val) {
          if (sel) sel.value = '';
          return;
        }
        var datalist = document.getElementById('agendaPatientsDatalist');
        if (datalist && sel) {
          var opts = datalist.querySelectorAll('option');
          for (var i = 0; i < opts.length; i++) {
            if (opts[i].value.toLowerCase().indexOf(val.toLowerCase()) !== -1) {
              sel.value = opts[i].dataset.id;
              input.value = opts[i].value;
              return;
            }
          }
        }
      };

      window.onPatientSelectDropdownChange = function(sel) {
        var input = document.getElementById('patientSearchInputBox');
        if (!input) return;
        if (!sel.value) {
          input.value = '';
          return;
        }
        var opt = sel.options[sel.selectedIndex];
        if (opt) {
          input.value = opt.textContent.trim();
        }
      };
    })();
    </script>

    <section class="panel">
      <h2>Marcar nova consulta</h2>
      <form class="form-stack" method="post" action="/admin/agenda">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <input type="hidden" name="returnMonth" value="${escapeHtml(monthKey)}">

        <div class="field">
          <span>Paciente</span>
          <div style="display:flex;gap:20px;margin-top:6px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
              <input type="radio" name="patientSelectionMode" value="existing" checked onchange="document.getElementById('existingPatientWrap').style.display='block';document.getElementById('newPatientWrap').style.display='none'">
              Paciente já cadastrada
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;color:var(--accent)">
              <input type="radio" name="patientSelectionMode" value="new" onchange="document.getElementById('existingPatientWrap').style.display='none';document.getElementById('newPatientWrap').style.display='block'">
              + Cadastrar nova paciente agora
            </label>
          </div>
        </div>

        <div id="existingPatientWrap">
          <label class="field">
            <span>Selecionar Paciente cadastrada (digite para buscar ou selecione na lista)</span>
            <div style="position:relative">
              <input type="text" id="patientSearchInputBox" list="agendaPatientsDatalist" placeholder="🔍 Digite nome, telefone ou código da paciente..."
                style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);font-size:0.92rem;background:#fff;box-sizing:border-box"
                oninput="onPatientDatalistInput(this)" onchange="onPatientDatalistChange(this)">
              <datalist id="agendaPatientsDatalist">
                ${patients.map((p) => `
                  <option data-id="${p.id}" value="${escapeHtml(toCodeNumber(p.patient_code))} - ${escapeHtml(p.full_name)}${p.phone ? ' (' + escapeHtml(p.phone) + ')' : ''}">
                `).join('')}
              </datalist>
            </div>
            <div style="margin-top:8px">
              <select name="patientId" id="agendaPatientSelect" onchange="onPatientSelectDropdownChange(this)">
                <option value="">— Ou selecione na lista completa de pacientes cadastradas (${patients.length}) —</option>
                ${patientOptions}
              </select>
            </div>
          </label>
        </div>

        <div id="newPatientWrap" style="display:none;background:rgba(173,95,66,0.06);padding:16px;border-radius:14px;border:1px solid var(--line);margin:6px 0 12px">
          <p style="margin:0 0 10px;font-weight:700;font-size:0.92rem;color:var(--accent)">Dados da Nova Paciente</p>
          <div class="form-grid">
            <label class="field">
              <span>Nome Completo *</span>
              <input type="text" name="newPatientName" placeholder="Ex.: Mariana Souza">
            </label>
            <label class="field">
              <span>WhatsApp / Telefone</span>
              <input type="tel" name="newPatientPhone" placeholder="(41) 99999-9999">
            </label>
            <label class="field">
              <span>E-mail</span>
              <input type="email" name="newPatientEmail" placeholder="mariana@email.com">
            </label>
          </div>
        </div>

        <label class="field" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:4px 0 10px">
          <input type="checkbox" name="generateAnamnese" value="1" checked>
          <span><strong>Gerar link da Ficha de Anamnese</strong> (prepara link e mensagem de WhatsApp automaticamente)</span>
        </label>

        <label class="field">
          <span>Título / Procedimento</span>
          <input type="text" name="title" placeholder="Ex.: Avaliação + Consulta de retorno" required>
        </label>
        <div class="field">
          <span>Início</span>
          <div class="date-time-pair">
            <input type="date" name="startDate" required>
            <input type="time" name="startTime" required>
          </div>
        </div>
        <div class="field">
          <span>Fim <span class="muted" style="font-size:0.82rem">(opcional)</span></span>
          <div class="date-time-pair">
            <input type="date" name="endDate">
            <input type="time" name="endTime">
          </div>
        </div>
        <label class="field">
          <span>Valor <span class="muted" style="font-size:0.82rem">(opcional)</span></span>
          <input type="number" name="value" min="0" step="0.01" placeholder="0,00">
        </label>
        <label class="field">
          <span>Observações</span>
          <textarea name="notes" rows="3" placeholder="Ex.: interesse em toxina botulínica e preenchimento labial"></textarea>
        </label>
        <button class="btn primary" type="submit">Salvar consulta</button>
      </form>
    </section>
  `;

  res.send(layout({ title: 'Agenda', body, userEmail: req.session.adminEmail, activeNav: 'agenda' }));
});

app.post('/admin/agenda', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const isNewPatient = req.body.patientSelectionMode === 'new';
  let resolvedPatientId = Number(req.body.patientId || 0) || null;
  const newName = String(req.body.newPatientName || '').trim();
  const newPhone = String(req.body.newPatientPhone || '').trim();
  const newEmail = String(req.body.newPatientEmail || '').trim();
  const generateAnamnese = req.body.generateAnamnese === 'on' || req.body.generateAnamnese === '1';

  const returnMonth = String(req.body.returnMonth || '').trim();
  const redirectMonth = /^\d{4}-\d{2}$/.test(returnMonth) ? returnMonth : monthKeyFromDate(new Date());

  if (isNewPatient) {
    if (!newName) {
      res.redirect(`/admin/agenda?month=${encodeURIComponent(redirectMonth)}&error=${encodeURIComponent('Informe o nome da nova paciente.')}`);
      return;
    }
    resolvedPatientId = getOrCreatePatientFromPayload({
      nomeCompleto: newName,
      telefone: newPhone,
      email: newEmail
    });
  }

  const title = String(req.body.title || '').trim();
  const startAt = combineDateTime(req.body.startDate, req.body.startTime);
  const endAt = combineDateTime(req.body.endDate, req.body.endTime) || null;
  const notes = String(req.body.notes || '').trim() || null;
  const value = parseFloat(String(req.body.value || '').replace(',', '.')) || null;

  if (!title || !startAt) {
    res.redirect(`/admin/agenda?month=${encodeURIComponent(redirectMonth)}&error=${encodeURIComponent('Preencha título e horário de início.')}`);
    return;
  }

  let patient = null;
  if (resolvedPatientId) {
    patient = db.prepare('SELECT id, full_name, phone, email FROM patients WHERE id = ?').get(resolvedPatientId);
    if (!patient && !isNewPatient) {
      res.redirect(`/admin/agenda?month=${encodeURIComponent(redirectMonth)}&error=${encodeURIComponent('Paciente inválida para agendamento.')}`);
      return;
    }
  }

  db.prepare(
    `
      INSERT INTO appointments (patient_id, title, start_at, end_at, notes, value, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)
    `
  ).run(resolvedPatientId, title, startAt, endAt, notes, value, nowIso());

  let anamneseQuery = '';
  if (generateAnamnese && resolvedPatientId && patient) {
    const token = crypto.randomBytes(18).toString('hex');
    db.prepare(
      `
        INSERT INTO patient_links (token, patient_id, patient_name_hint, patient_email_hint, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(token, resolvedPatientId, patient.full_name, patient.email, nowIso());
    anamneseQuery = `&newAnamneseToken=${encodeURIComponent(token)}&newPatientId=${resolvedPatientId}`;
  }

  const targetMonth = String(startAt).slice(0, 7);
  const monthToOpen = /^\d{4}-\d{2}$/.test(targetMonth) ? targetMonth : redirectMonth;
  res.redirect(`/admin/agenda?month=${encodeURIComponent(monthToOpen)}&created=1${anamneseQuery}`);
});

app.get('/admin/submissions/:id', requireAuth, (req, res) => {
  const submissionId = Number(req.params.id);
  const submission = db
    .prepare(
      `
      SELECT
        s.*,
        l.patient_name_hint,
        l.patient_email_hint,
        p.id AS patient_id,
        p.patient_code,
        p.full_name AS patient_full_name,
        p.email AS patient_email
      FROM submissions s
      JOIN patient_links l ON l.id = s.link_id
      LEFT JOIN patients p ON p.id = s.patient_id
      WHERE s.id = ?
      `
    )
    .get(submissionId);

  if (!submission) {
    res.status(404).send('Resposta não encontrada.');
    return;
  }

  const data = JSON.parse(submission.data_json || '{}');
  const files = db
    .prepare('SELECT * FROM submission_files WHERE submission_id = ? ORDER BY id ASC')
    .all(submissionId);

  const faceFiles = files.filter((file) => file.category === 'face');
  const productFiles = files.filter((file) => file.category === 'product');
  const examFiles = files.filter((file) => file.category === 'exam');

  const sectionsHtml = formSections
    .map((section) => {
      const rows = section.fields
        .map((field) => {
          const value = data[field.name];
          return `
            <div class="answer-row">
              <dt>${escapeHtml(field.label)}</dt>
              <dd>${safeFieldValue(value)}</dd>
            </div>
          `;
        })
        .join('');

      return `
        <section class="panel answer-panel">
          <h2>${escapeHtml(section.title)}</h2>
          <dl>${rows}</dl>
        </section>
      `;
    })
    .join('');

  const renderImageList = (title, list) => {
    if (!list.length) {
      return `
        <section class="panel answer-panel">
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">Sem imagens enviadas.</p>
        </section>
      `;
    }

    const items = list
      .map(
        (file) => `
          <figure class="image-card">
            <img src="/admin/file/${file.id}" alt="${escapeHtml(file.original_name)}" loading="lazy">
            <figcaption>${escapeHtml(file.original_name)}</figcaption>
          </figure>
        `
      )
      .join('');

    return `
      <section class="panel answer-panel">
        <h2>${escapeHtml(title)}</h2>
        <div class="image-grid">${items}</div>
      </section>
    `;
  };

  const renderFileList = (title, list) => {
    if (!list.length) {
      return `
        <section class="panel answer-panel">
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">Nenhum arquivo enviado.</p>
        </section>
      `;
    }

    const items = list
      .map((file) => {
        const isPdf = file.mime_type === 'application/pdf' || file.original_name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          return `
            <a class="file-card-doc" href="/admin/file/${file.id}" target="_blank" rel="noopener">
              <span class="file-doc-icon">📄</span>
              <span>${escapeHtml(file.original_name)}</span>
            </a>
          `;
        }
        return `
          <figure class="image-card">
            <img src="/admin/file/${file.id}" alt="${escapeHtml(file.original_name)}" loading="lazy">
            <figcaption>${escapeHtml(file.original_name)}</figcaption>
          </figure>
        `;
      })
      .join('');

    return `
      <section class="panel answer-panel">
        <h2>${escapeHtml(title)}</h2>
        <div class="image-grid">${items}</div>
      </section>
    `;
  };

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Resposta enviada em ${escapeHtml(new Date(submission.created_at).toLocaleString('pt-BR'))}</p>
        <h1>
          ${submission.patient_code ? `<span class="patient-code">${escapeHtml(toCodeNumber(submission.patient_code))}</span>` : ''}
          ${escapeHtml(submission.patient_full_name || data.nomeCompleto || submission.patient_name_hint || 'Paciente')}
        </h1>
        <p class="muted">${escapeHtml(submission.patient_email || data.email || submission.patient_email_hint || '-')}</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
        ${submission.patient_id ? `<a class="btn" href="/admin/patients/${submission.patient_id}">Prontuário da paciente</a>` : ''}
        <a class="btn" href="/admin/submissions/${submissionId}/print" target="_blank">Imprimir / PDF</a>
        <a class="btn primary" href="/admin/chat?submissionId=${submissionId}&patientId=${submission.patient_id || ''}">Conversar com IA sobre este caso</a>
      </div>
    </header>

    ${renderAlert(req.query.upload === 'ok' ? 'Imagens adicionadas ao caso.' : null, 'success')}
    ${renderAlert(req.query.uploadError || null, 'error')}

    <section class="panel answer-panel">
      <h2>Adicionar mais fotos ao caso</h2>
      <form class="form-stack" method="post" action="/admin/submissions/${submissionId}/files" enctype="multipart/form-data">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <label class="field">
          <span>Novas fotos do rosto</span>
          <input type="file" name="facePhotos" accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp" multiple>
        </label>
        <label class="field">
          <span>Novas fotos de produtos ou exames</span>
          <input type="file" name="productPhotos" accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,application/pdf" multiple>
        </label>
        <button class="btn primary" type="submit">Adicionar fotos</button>
      </form>
    </section>

    ${sectionsHtml}
    ${renderFileList('Arquivos de Exames', examFiles)}
    ${renderImageList('Fotos do rosto', faceFiles)}
    ${renderImageList('Fotos de produtos', productFiles)}

    ${submission.signature_data ? `
    <section class="panel">
      <h2>Assinatura digital</h2>
      <div class="signature-display">
        <img src="${submission.signature_data}" alt="Assinatura da paciente" style="max-width:400px;border:1px solid var(--line);border-radius:11px;background:#fff;padding:8px;">
      </div>
    </section>` : ''}
  `;

  res.send(layout({ title: `Resposta ${submissionId}`, body, userEmail: req.session.adminEmail }));
});

app.post('/admin/submissions/:id/files', requireAuth, (req, res) => {
  uploadPatientFiles(req, res, (uploadError) => {
    const submissionId = Number(req.params.id);

    if (uploadError) {
      let errorMsg = uploadError.message;
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        errorMsg = 'Uma ou mais fotos ultrapassam o tamanho permitido (limite de 100 MB por imagem).';
      } else if (uploadError.code === 'LIMIT_FILE_COUNT') {
        errorMsg = 'Número máximo de fotos por envio excedido.';
      }
      res.redirect(`/admin/submissions/${submissionId}?uploadError=${encodeURIComponent(errorMsg)}`);
      return;
    }

    if (!verifyCsrf(req)) {
      res.status(403).send('CSRF inválido.');
      return;
    }

    const submission = db.prepare('SELECT id FROM submissions WHERE id = ?').get(submissionId);
    if (!submission) {
      res.status(404).send('Resposta não encontrada.');
      return;
    }

    const files = req.files || {};
    const insertFile = db.prepare(
      `
        INSERT INTO submission_files
          (submission_id, category, original_name, stored_name, mime_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    );

    const tx = db.transaction(() => {
      for (const file of files.facePhotos || []) {
        insertFile.run(submissionId, 'face', file.originalname, file.filename, file.mimetype || null, nowIso());
      }

      for (const file of files.productPhotos || []) {
        insertFile.run(submissionId, 'product', file.originalname, file.filename, file.mimetype || null, nowIso());
      }
    });

    tx();

    res.redirect(`/admin/submissions/${submissionId}?upload=ok`);
  });
});

app.get('/admin/file/:id', requireAuth, (req, res) => {
  const fileId = Number(req.params.id);
  const file = db.prepare('SELECT * FROM submission_files WHERE id = ?').get(fileId);

  if (!file) {
    res.status(404).send('Arquivo não encontrado.');
    return;
  }

  const absPath = path.join(uploadDir, file.stored_name);
  if (!fs.existsSync(absPath)) {
    res.status(404).send('Arquivo não encontrado no armazenamento.');
    return;
  }

  const ext = path.extname(file.stored_name).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.pdf': 'application/pdf'
  };
  const mime = (file.mime_type && file.mime_type !== 'application/octet-stream') ? file.mime_type : (mimeMap[ext] || 'image/jpeg');
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(absPath);
});

app.get('/admin/chat', requireAuth, (req, res) => {
  const selectedSubmissionId = Number(req.query.submissionId || 0) || null;
  const selectedPatientId = Number(req.query.patientId || 0) || null;
  const focusedMode = !!(selectedSubmissionId || selectedPatientId);

  // ── Modo focado: paciente/caso específico ──────────────────────
  if (focusedMode) {
    // Dados da paciente
    const patientRow = selectedPatientId
      ? db.prepare('SELECT id, patient_code, full_name FROM patients WHERE id = ?').get(selectedPatientId)
      : selectedSubmissionId
        ? db.prepare('SELECT p.id, p.patient_code, p.full_name FROM patients p JOIN submissions s ON s.patient_id = p.id WHERE s.id = ?').get(selectedSubmissionId)
        : null;

    // Mensagens filtradas
    let messages;
    if (selectedSubmissionId) {
      messages = db.prepare(
        'SELECT role, content, created_at FROM chat_messages WHERE submission_id = ? ORDER BY id ASC'
      ).all(selectedSubmissionId);
    } else {
      messages = db.prepare(
        'SELECT role, content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY id ASC'
      ).all(selectedPatientId);
    }

    const patientName = patientRow ? `${toCodeNumber(patientRow.patient_code)} — ${patientRow.full_name}` : 'Paciente';
    const backLink = patientRow ? `/admin/patients/${patientRow.id}` : '/admin';
    const caseLabel = selectedSubmissionId ? ` · Caso #${selectedSubmissionId}` : '';

    const bubblesHtml = messages.map((msg) => {
      const isAi = msg.role === 'assistant';
      const contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br>');
      const time = new Date(msg.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="bubble-wrap ${isAi ? 'bubble-wrap--ai' : 'bubble-wrap--user'}">
          <div class="bubble ${isAi ? 'bubble--ai' : 'bubble--user'}">
            <div class="bubble-text">${contentHtml}</div>
            <span class="bubble-time">${time}</span>
          </div>
        </div>`;
    }).join('');

    const body = `
      <header class="panel header-panel">
        <div>
          <p class="eyebrow">Chat clínico${escapeHtml(caseLabel)}</p>
          <h1>${escapeHtml(patientName)}</h1>
        </div>
        <div class="header-actions">
          <a class="btn" href="${backLink}">← Prontuário</a>
          <a class="btn" href="/admin/chat">Chat geral</a>
        </div>
      </header>

      ${renderAlert(req.query.error, 'error')}

      <section class="panel focused-chat">
        <div class="focused-chat-feed" id="chatFeed">
          ${bubblesHtml || '<p class="muted" style="text-align:center;padding:24px">Nenhuma mensagem ainda. Envie a primeira abaixo.</p>'}
        </div>

        <form class="focused-chat-form" method="post" action="/admin/chat">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          ${selectedSubmissionId ? `<input type="hidden" name="submissionId" value="${selectedSubmissionId}">` : ''}
          ${selectedPatientId || (patientRow && patientRow.id) ? `<input type="hidden" name="patientId" value="${selectedPatientId || patientRow.id}">` : ''}
          <textarea class="focused-chat-input" name="message" rows="2" required
            placeholder="Escreva sua mensagem…"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.submit();}"></textarea>
          <button class="btn primary focused-chat-send" type="submit">Enviar</button>
        </form>
      </section>

      <script>
        (function(){
          var feed = document.getElementById('chatFeed');
          if(feed) feed.scrollTop = feed.scrollHeight;
        })();
      </script>
    `;

    return res.send(layout({ title: `Chat — ${patientName}`, body, userEmail: req.session.adminEmail }));
  }

  // ── Modo global (sem paciente/caso) ───────────────────────────
  const submissions = db.prepare(
    `SELECT s.id, s.patient_id, p.patient_code, p.full_name AS patient_name,
       json_extract(s.data_json, '$.nomeCompleto') AS nome
     FROM submissions s LEFT JOIN patients p ON p.id = s.patient_id
     ORDER BY s.id DESC LIMIT 200`
  ).all();

  const patients = db.prepare('SELECT id, patient_code, full_name FROM patients ORDER BY id ASC').all();

  const messages = db.prepare(
    `SELECT m.*, p.patient_code, p.full_name AS patient_name
     FROM chat_messages m LEFT JOIN patients p ON p.id = m.patient_id
     ORDER BY m.id ASC LIMIT 200`
  ).all();

  const messagesHtml = messages.map((msg) => {
    const cssRole = msg.role === 'assistant' ? 'assistant' : 'user';
    const submissionTag = msg.submission_id ? `<span class="msg-tag">Caso #${msg.submission_id}</span>` : '';
    const patientTag = msg.patient_id
      ? `<span class="msg-tag patient">${escapeHtml(toCodeNumber(msg.patient_code || msg.patient_id))} — ${escapeHtml(msg.patient_name || '')}</span>`
      : '';
    return `
      <article class="chat-message ${cssRole}">
        <header>
          <strong>${msg.role === 'assistant' ? '🤖 IA' : '👩‍⚕️ Você'}</strong>
          ${submissionTag}${patientTag}
          <span>${escapeHtml(new Date(msg.created_at).toLocaleString('pt-BR'))}</span>
        </header>
        <p>${escapeHtml(msg.content)}</p>
      </article>`;
  }).join('');

  const options = submissions.map((item) => {
    const labelName = item.patient_name || item.nome || `Caso ${item.id}`;
    const codeText = item.patient_code ? toCodeNumber(item.patient_code) : '----';
    return `<option value="${item.id}">#${item.id} — ${escapeHtml(codeText)} ${escapeHtml(labelName)}</option>`;
  }).join('');

  const patientOptions = patients.map((item) =>
    `<option value="${item.id}">${escapeHtml(toCodeNumber(item.patient_code))} — ${escapeHtml(item.full_name)}</option>`
  ).join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Assistente clínica com IA</p>
        <h1>Chat clínico</h1>
        <p class="muted">A IA recebe contexto completo da plataforma para raciocinar com base em dados reais.</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
      </div>
    </header>

    ${renderAlert(req.query.error, 'error')}

    <section class="panel chat-wrap">
      <div class="chat-feed">
        ${messagesHtml || '<p class="muted" style="text-align:center;padding:24px">Ainda não há mensagens. Para analisar uma paciente, abra o prontuário dela e clique em "Continuar conversa".</p>'}
      </div>

      <form class="form-stack" method="post" action="/admin/chat">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">
            <span>Paciente (opcional)</span>
            <select name="patientId">
              <option value="">Sem paciente específica</option>
              ${patientOptions}
            </select>
          </label>
          <label class="field">
            <span>Caso (opcional)</span>
            <select name="submissionId">
              <option value="">Sem caso específico</option>
              ${options}
            </select>
          </label>
        </div>
        <label class="field">
          <span>Mensagem</span>
          <textarea name="message" rows="4" required placeholder="Ex.: Analise o caso e sugira uma rotina inicial para pele sensível com manchas."></textarea>
        </label>
        <button class="btn primary" type="submit">Enviar para IA</button>
      </form>
    </section>

    <script>
      (function(){
        var feed = document.querySelector('.chat-feed');
        if(feed) feed.scrollTop = feed.scrollHeight;
      })();
    </script>
  `;

  res.send(layout({ title: 'Chat LLM', body, userEmail: req.session.adminEmail }));
});

app.post('/admin/chat', requireAuth, async (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const message = String(req.body.message || '').trim();
  const submissionId = Number(req.body.submissionId || 0) || null;
  let patientId = Number(req.body.patientId || 0) || null;

  if (!message) {
    res.redirect('/admin/chat?error=Digite uma mensagem');
    return;
  }

  if (!patientId && submissionId) {
    const fromSubmission = db.prepare('SELECT patient_id FROM submissions WHERE id = ?').get(submissionId);
    patientId = fromSubmission?.patient_id || null;
  }

  db.prepare(
    `
    INSERT INTO chat_messages (admin_id, patient_id, submission_id, role, content, created_at)
    VALUES (?, ?, ?, 'user', ?, ?)
    `
  ).run(req.session.adminId, patientId, submissionId, message, nowIso());

  try {
    const assistantReply = await callLlm(message, submissionId, patientId);
    db.prepare(
      `
      INSERT INTO chat_messages (admin_id, patient_id, submission_id, role, content, created_at)
      VALUES (?, ?, ?, 'assistant', ?, ?)
      `
    ).run(req.session.adminId, patientId, submissionId, assistantReply, nowIso());
  } catch (error) {
    db.prepare(
      `
      INSERT INTO chat_messages (admin_id, patient_id, submission_id, role, content, created_at)
      VALUES (?, ?, ?, 'assistant', ?, ?)
      `
    ).run(req.session.adminId, patientId, submissionId, `Erro ao consultar LLM: ${error.message}`, nowIso());
  }

  const queryParts = [];
  if (submissionId) {
    queryParts.push(`submissionId=${encodeURIComponent(submissionId)}`);
  }
  if (patientId) {
    queryParts.push(`patientId=${encodeURIComponent(patientId)}`);
  }
  const qs = queryParts.length ? `?${queryParts.join('&')}` : '';
  res.redirect(`/admin/chat${qs}`);
});

function buildGlobalKnowledgeBase() {
  const patients = db
    .prepare('SELECT id, patient_code, full_name, email, phone, created_at, updated_at FROM patients ORDER BY id ASC')
    .all();

  const submissions = db
    .prepare('SELECT id, patient_id, link_id, created_at, data_json FROM submissions ORDER BY id ASC')
    .all()
    .map((item) => {
      let parsed = {};
      try {
        parsed = JSON.parse(item.data_json || '{}');
      } catch (_error) {
        parsed = {};
      }
      return {
        id: item.id,
        patient_id: item.patient_id,
        link_id: item.link_id,
        created_at: item.created_at,
        answers: parsed
      };
    });

  const appointments = db
    .prepare(
      `
      SELECT
        a.id,
        a.patient_id,
        a.title,
        a.start_at,
        a.end_at,
        a.notes,
        a.status,
        p.patient_code,
        p.full_name
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patient_id
      ORDER BY a.start_at ASC
      `
    )
    .all();

  const payload = {
    generated_at: nowIso(),
    totals: {
      patients: patients.length,
      submissions: submissions.length,
      appointments: appointments.length
    },
    patients,
    submissions,
    appointments
  };

  let json = JSON.stringify(payload);
  if (json.length <= 180000) {
    return json;
  }

  // Fallback de segurança para evitar payload exagerado em bases muito grandes.
  const compact = {
    generated_at: nowIso(),
    totals: payload.totals,
    patients: patients.map((p) => ({
      id: p.id,
      patient_code: p.patient_code,
      full_name: p.full_name,
      email: p.email,
      phone: p.phone
    })),
    submissions: submissions.map((s) => ({
      id: s.id,
      patient_id: s.patient_id,
      created_at: s.created_at,
      queixaPrincipal: s.answers.queixaPrincipal || null,
      expectativaConsultoria: s.answers.expectativaConsultoria || null
    })),
    appointments: appointments.map((a) => ({
      id: a.id,
      patient_id: a.patient_id,
      patient_code: a.patient_code,
      patient_name: a.full_name,
      title: a.title,
      start_at: a.start_at,
      status: a.status
    }))
  };

  return JSON.stringify(compact);
}

async function triggerAutoAnalysis(submissionId, patientId) {
  if (!submissionId) return;

  // Evita re-análise se já existe alguma mensagem para este caso
  const existing = db.prepare('SELECT id FROM chat_messages WHERE submission_id = ? LIMIT 1').get(submissionId);
  if (existing) return;

  const admin = db.prepare('SELECT id FROM admins ORDER BY id ASC LIMIT 1').get();
  if (!admin) return;

  const prompt = [
    'Faça uma pré-análise completa da ficha desta paciente.',
    'Organize em tópicos claros:',
    '1) Perfil da pele e queixas principais',
    '2) Avaliação dos produtos em uso (são adequados para as queixas e tipo de pele?)',
    '3) Pontos de atenção (ingredientes conflitantes, riscos, alergias reportadas)',
    '4) Sugestões iniciais de rotina (AM e PM)',
    '5) Perguntas que a profissional pode querer aprofundar na consulta.',
    'Use bullet points. Seja clara e objetiva para uma esteticista clínica.'
  ].join(' ');

  const analysis = await callLlm(prompt, submissionId, patientId);

  db.prepare(
    'INSERT INTO chat_messages (admin_id, patient_id, submission_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(admin.id, patientId, submissionId, 'assistant', `📋 Pré-análise automática\n\n${analysis}`, nowIso());
}

async function callLlm(currentMessage, submissionId, patientId) {
  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4.1';

  if (!apiKey) {
    throw new Error('Defina LLM_API_KEY no arquivo .env');
  }

  // Memória scoped: prioriza o caso selecionado, depois a paciente, depois global
  let recentMessages;
  if (submissionId) {
    recentMessages = db
      .prepare('SELECT role, content FROM chat_messages WHERE submission_id = ? ORDER BY id DESC LIMIT 30')
      .all(submissionId)
      .reverse();
  } else if (patientId) {
    recentMessages = db
      .prepare('SELECT role, content FROM chat_messages WHERE patient_id = ? ORDER BY id DESC LIMIT 30')
      .all(patientId)
      .reverse();
  } else {
    recentMessages = db
      .prepare('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 20')
      .all()
      .reverse();
  }

  const contextBlocks = [];
  const knowledgeBase = buildGlobalKnowledgeBase();

  contextBlocks.push('Base global da plataforma em JSON (pacientes, respostas e agenda):');
  contextBlocks.push(knowledgeBase);

  if (patientId) {
    const patient = db
      .prepare('SELECT id, patient_code, full_name, email, phone FROM patients WHERE id = ?')
      .get(patientId);

    if (patient) {
      contextBlocks.push('Paciente selecionada para foco:');
      contextBlocks.push(JSON.stringify(patient));
    }
  }

  // Imagens do caso para enviar à API (vision)
  const imageContentBlocks = [];

  if (submissionId) {
    const submission = db
      .prepare('SELECT id, data_json FROM submissions WHERE id = ?')
      .get(submissionId);

    if (submission) {
      const data = JSON.parse(submission.data_json || '{}');
      const summaryLines = Object.entries(data)
        .filter(([key, value]) => key !== '_csrf' && value !== '' && value !== null && value !== undefined)
        .map(([key, value]) => {
          const label = fieldLabels[key] || key;
          const normalized = Array.isArray(value) ? value.join(', ') : String(value);
          return `- ${label}: ${normalized}`;
        });

      contextBlocks.push(`Caso selecionado #${submission.id} para foco:`);
      contextBlocks.push('Resumo das respostas:');
      contextBlocks.push(summaryLines.join('\n'));

      // Carregar imagens para envio via vision
      const submissionFiles = db
        .prepare(`SELECT category, stored_name, mime_type FROM submission_files WHERE submission_id = ? ORDER BY id ASC`)
        .all(submissionId);

      // Face: até 4 fotos com detail "high"; Produtos: até 6 com detail "low"
      const faceFiles = submissionFiles.filter((f) => f.category === 'face').slice(0, 4);
      const productFiles = submissionFiles.filter((f) => f.category === 'product').slice(0, 6);

      const supportedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

      for (const file of faceFiles) {
        const mime = file.mime_type && supportedMimes.includes(file.mime_type) ? file.mime_type : 'image/jpeg';
        const filePath = path.join(uploadDir, file.stored_name);
        if (fs.existsSync(filePath)) {
          const b64 = fs.readFileSync(filePath).toString('base64');
          imageContentBlocks.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' }
          });
        }
      }

      for (const file of productFiles) {
        const mime = file.mime_type && supportedMimes.includes(file.mime_type) ? file.mime_type : 'image/jpeg';
        const filePath = path.join(uploadDir, file.stored_name);
        if (fs.existsSync(filePath)) {
          const b64 = fs.readFileSync(filePath).toString('base64');
          imageContentBlocks.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${b64}`, detail: 'low' }
          });
        }
      }

      if (imageContentBlocks.length > 0) {
        const faceCount = faceFiles.filter((f) => {
          return fs.existsSync(path.join(uploadDir, f.stored_name));
        }).length;
        const prodCount = productFiles.filter((f) => {
          return fs.existsSync(path.join(uploadDir, f.stored_name));
        }).length;
        contextBlocks.push(`Imagens incluídas nesta mensagem: ${faceCount} foto(s) do rosto (alta resolução) e ${prodCount} foto(s) de produtos (baixa resolução).`);
      }
    }
  }

  const systemPrompt = [
    'Você é uma assistente clínica especializada em skincare e estética facial, suporte à Fransuele Hanel, esteticista clínica.',
    'Responda sempre em português do Brasil.',
    'Você tem acesso completo à base de dados da plataforma: fichas das pacientes, respostas do questionário, produtos em uso, agenda e histórico de conversas.',
    'Raciocine com base nos dados reais fornecidos. Cruze informações (ex.: tipo de pele × produtos × queixas) para dar respostas precisas.',
    'Mantenha o contexto da conversa: lembre o que foi dito anteriormente nesta sessão.',
    'Ao analisar uma ficha: identifique o tipo de pele, queixas principais, ingredientes problemáticos nos produtos, rotina inadequada e oportunidades de melhora.',
    'Formate respostas longas com tópicos e bullet points para facilitar a leitura.',
    'Seja objetiva, segura e ética. Nunca substitua diagnóstico médico ou dermatológico.',
    'Quando houver risco clínico (alergia, reação intensa, suspeita de doença de pele), sempre oriente consultar dermatologista.',
    'Quando sugerir produtos, priorize aqueles já citados pela paciente antes de sugerir novos.'
  ].join(' ');

  const messages = [{ role: 'system', content: systemPrompt }];

  // Injeta conhecimento personalizado salvo pela profissional
  const knowledgeEntries = db.prepare(
    'SELECT titulo, conteudo FROM ai_knowledge WHERE ativo = 1 ORDER BY ordem ASC, id ASC'
  ).all();
  if (knowledgeEntries.length > 0) {
    const knowledgeBlock =
      '## Conhecimento e Protocolos da Clínica\n\n' +
      knowledgeEntries.map((e) => `### ${e.titulo}\n${e.conteudo}`).join('\n\n');
    messages.push({ role: 'system', content: knowledgeBlock });
  }

  if (contextBlocks.length > 0) {
    messages.push({ role: 'system', content: contextBlocks.join('\n') });
  }

  for (const msg of recentMessages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      continue;
    }
    messages.push({ role: msg.role, content: msg.content });
  }

  // Monta a mensagem atual — com imagens se houver (vision)
  if (imageContentBlocks.length > 0) {
    // Inclui imagens junto com a mensagem de texto (vision)
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: currentMessage },
        ...imageContentBlocks
      ]
    });
  } else if (!recentMessages.length) {
    messages.push({ role: 'user', content: currentMessage });
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      reasoning_effort: 'high'
    })
  });

  if (!response.ok) {
    const body = await response.text();
    let friendlyMsg = `Erro na API (${response.status})`;
    try {
      const parsed = JSON.parse(body);
      const code = parsed?.error?.code || parsed?.error?.type || '';
      if (response.status === 429 || code === 'insufficient_quota') {
        friendlyMsg = 'Créditos da API esgotados. Acesse platform.openai.com/account/billing para recarregar.';
      } else if (response.status === 401) {
        friendlyMsg = 'Chave de API inválida. Verifique a variável LLM_API_KEY no servidor.';
      } else if (response.status === 503 || response.status === 502) {
        friendlyMsg = 'API temporariamente indisponível. Tente novamente em alguns instantes.';
      } else if (parsed?.error?.message) {
        friendlyMsg = `Erro da API: ${parsed.error.message.slice(0, 200)}`;
      }
    } catch (_) {
      friendlyMsg = `API retornou ${response.status}`;
    }
    throw new Error(friendlyMsg);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('A API respondeu sem conteúdo em choices[0].message.content');
  }

  return String(content).trim();
}

// ─── Agenda: editar agendamento (modal) ────────────────────────────────────
app.post('/admin/agenda/:id/edit', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }

  const apptId = Number(req.params.id);
  const title = String(req.body.title || '').trim();
  const startAt = combineDateTime(req.body.startDate, req.body.startTime);
  const endAt = combineDateTime(req.body.endDate, req.body.endTime) || null;
  const notes = String(req.body.notes || '').trim() || null;
  const value = parseFloat(String(req.body.value || '').replace(',', '.')) || null;
  const returnMonth = String(req.body.returnMonth || '').trim();
  const returnPatient = Number(req.body.returnPatient || 0);
  const status = ['scheduled', 'confirmed', 'completed', 'cancelled'].includes(req.body.status) ? req.body.status : null;
  const newPatientId = req.body.patientId !== undefined ? (Number(req.body.patientId) || null) : undefined;

  if (!title || !startAt) {
    if (returnPatient) {
      res.redirect(`/admin/patients/${returnPatient}?error=${encodeURIComponent('Preencha título e horário.')}#agenda`);
      return;
    }
    const m = /^\d{4}-\d{2}$/.test(returnMonth) ? returnMonth : monthKeyFromDate(new Date());
    res.redirect(`/admin/agenda?month=${m}&error=${encodeURIComponent('Preencha título e horário.')}`);
    return;
  }

  const appt = db.prepare('SELECT id, start_at FROM appointments WHERE id = ?').get(apptId);
  if (!appt) { res.status(404).send('Agendamento não encontrado.'); return; }

  if (status && newPatientId !== undefined) {
    db.prepare('UPDATE appointments SET title=?, start_at=?, end_at=?, notes=?, value=?, status=?, patient_id=? WHERE id=?')
      .run(title, startAt, endAt, notes, value, status, newPatientId, apptId);
  } else if (status) {
    db.prepare('UPDATE appointments SET title=?, start_at=?, end_at=?, notes=?, value=?, status=? WHERE id=?')
      .run(title, startAt, endAt, notes, value, status, apptId);
  } else if (newPatientId !== undefined) {
    db.prepare('UPDATE appointments SET title=?, start_at=?, end_at=?, notes=?, value=?, patient_id=? WHERE id=?')
      .run(title, startAt, endAt, notes, value, newPatientId, apptId);
  } else {
    db.prepare('UPDATE appointments SET title=?, start_at=?, end_at=?, notes=?, value=? WHERE id=?')
      .run(title, startAt, endAt, notes, value, apptId);
  }

  if (returnPatient) {
    res.redirect(`/admin/patients/${returnPatient}?updated_appt=1#agenda`);
    return;
  }

  const targetMonth = String(startAt).slice(0, 7);
  const m = /^\d{4}-\d{2}$/.test(targetMonth) ? targetMonth : returnMonth;
  res.redirect(`/admin/agenda?month=${encodeURIComponent(m)}&updated=1`);
});

// ─── Agenda: atualizar status de consulta ─────────────────────────────────
app.post('/admin/agenda/:id/status', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const appointmentId = Number(req.params.id);
  const newStatus = String(req.body.status || '').trim();
  const returnPatient = Number(req.body.returnPatient || 0) || null;
  const returnMonth = String(req.body.returnMonth || '').trim();

  if (!['scheduled', 'confirmed', 'cancelled'].includes(newStatus)) {
    res.status(400).send('Status inválido.');
    return;
  }

  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
  if (!appointment) {
    res.status(404).send('Consulta não encontrada.');
    return;
  }

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(newStatus, appointmentId);

  if (returnPatient) {
    res.redirect(`/admin/patients/${returnPatient}`);
    return;
  }

  const month = returnMonth || String(appointment.start_at || '').slice(0, 7) || monthKeyFromDate(new Date());
  res.redirect(`/admin/agenda?month=${encodeURIComponent(month)}&updated=1`);
});

// ─── Submissão: view de impressão / PDF ───────────────────────────────────
app.get('/admin/submissions/:id/print', requireAuth, (req, res) => {
  const submissionId = Number(req.params.id);
  const submission = db
    .prepare(
      `
      SELECT
        s.*,
        l.patient_name_hint,
        p.id AS patient_id,
        p.patient_code,
        p.full_name AS patient_full_name,
        p.email AS patient_email,
        p.phone AS patient_phone
      FROM submissions s
      JOIN patient_links l ON l.id = s.link_id
      LEFT JOIN patients p ON p.id = s.patient_id
      WHERE s.id = ?
      `
    )
    .get(submissionId);

  if (!submission) {
    res.status(404).send('Resposta não encontrada.');
    return;
  }

  const data = JSON.parse(submission.data_json || '{}');

  const sectionsHtml = formSections
    .map((section, idx) => {
      const rows = section.fields
        .map((field) => {
          const value = data[field.name];
          if (value === undefined || value === null || value === '') {
            return `<tr><td style="color:#777;font-size:0.84rem;padding:4px 8px 4px 0;width:45%;vertical-align:top;border-bottom:1px solid #ede8e1">${escapeHtml(field.label)}</td><td style="color:#aaa;font-size:0.84rem;padding:4px 0;vertical-align:top;border-bottom:1px solid #ede8e1">—</td></tr>`;
          }
          return `<tr><td style="font-weight:600;font-size:0.84rem;color:#18261e;padding:5px 8px 5px 0;width:45%;vertical-align:top;border-bottom:1px solid #ede8e1">${escapeHtml(field.label)}</td><td style="font-size:0.84rem;color:#2f3b33;padding:5px 0;vertical-align:top;border-bottom:1px solid #ede8e1">${safeFieldValue(value)}</td></tr>`;
        })
        .join('');

      return `
        <div style="margin-bottom:22px;page-break-inside:avoid">
          <h3 style="font-family:'Cinzel',Georgia,serif;font-size:0.95rem;color:#1c3f2d;border-bottom:2px solid #c5a059;padding-bottom:5px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.04em">
            ${idx + 1}. ${escapeHtml(section.title)}
          </h3>
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>
      `;
    })
    .join('');

  const code = submission.patient_code ? toCodeNumber(submission.patient_code) : '----';
  const patientName = submission.patient_full_name || data.nomeCompleto || submission.patient_name_hint || 'Paciente';
  const date = new Date(submission.created_at).toLocaleString('pt-BR');

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Ficha de Anamnese — ${escapeHtml(patientName)} (${escapeHtml(code)})</title>
      <style>
        @page { margin: 15mm 18mm; size: A4; }
        body { font-family: 'Georgia', serif; color: #18261e; font-size: 13px; line-height: 1.5; margin: 0 auto; max-width: 800px; padding: 24px; background: #fff; }
        .doc-header { background: #1c3f2d; color: #fff; border-radius: 10px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border: 1px solid #d4be88; }
        .doc-header-left { display: flex; align-items: center; gap: 14px; }
        .doc-logo { width: 48px; height: 48px; object-fit: contain; }
        .doc-title { margin: 0; font-family: 'Cinzel', Georgia, serif; font-size: 1.25rem; letter-spacing: 0.08em; color: #e2c275; text-transform: uppercase; font-weight: bold; }
        .doc-sub { margin: 2px 0 0; font-size: 0.75rem; letter-spacing: 0.1em; color: #f7f5f0; opacity: 0.9; text-transform: uppercase; }
        .doc-meta-right { text-align: right; font-size: 0.8rem; color: #e2c275; border-left: 1px solid rgba(226, 194, 117, 0.4); padding-left: 14px; }
        .doc-meta-right strong { color: #fff; }
        .pill-title { display: inline-block; background: #f4efe7; border: 1px solid #d4be88; color: #1c3f2d; padding: 6px 14px; border-radius: 999px; font-weight: bold; font-size: 0.88rem; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.04em; }
        .meta-box { background: #fdfbf7; border: 1px solid #ded6ca; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 0.88rem; line-height: 1.6; }
        .signatures-grid { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; align-items: end; page-break-inside: avoid; }
        .sig-block { border-top: 2px solid #1c3f2d; padding-top: 10px; font-size: 0.86rem; }
        .no-print { margin-top: 32px; text-align: center; }
        @media print { .no-print { display: none !important; } body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc-header">
        <div class="doc-header-left">
          <img src="/public/logo-fh.png" alt="Dra. Fran Hanel" class="doc-logo">
          <div>
            <div class="doc-title">Dra. Fransuele Hanel</div>
            <div class="doc-sub">Biomedicina Estética Avançada & Integrativa</div>
          </div>
        </div>
        <div class="doc-meta-right">
          <div>CRBM-5: <strong>015427</strong></div>
          <div>Prontuário: <strong>#${escapeHtml(code)}</strong></div>
        </div>
      </div>

      <div class="pill-title">Ficha Oficial de Anamnese Clínica & Estética</div>

      <div class="meta-box">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><strong>Paciente:</strong> ${escapeHtml(patientName)}</div>
          <div><strong>Prontuário:</strong> #${escapeHtml(code)}</div>
          <div><strong>CPF:</strong> ${escapeHtml(data.cpf || '-')}</div>
          <div><strong>Nascimento:</strong> ${escapeHtml(data.dataNascimento || '-')}</div>
          <div><strong>WhatsApp:</strong> ${escapeHtml(submission.patient_phone || data.whatsapp || data.telefone || '-')}</div>
          <div><strong>E-mail:</strong> ${escapeHtml(submission.patient_email || data.email || '-')}</div>
        </div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #dcd3c5;font-size:0.82rem;color:#555">
          Preenchido e registrado em: <strong>${escapeHtml(date)}</strong>
        </div>
      </div>

      ${sectionsHtml}

      <div class="signatures-grid">
        <div class="sig-block">
          ${submission.signature_data ? `
            <img src="${escapeHtml(submission.signature_data)}" alt="Assinatura da Paciente" style="max-height:75px;display:block;margin-bottom:6px">
          ` : '<div style="height:50px"></div>'}
          <strong>${escapeHtml(data.assinatura || patientName)}</strong><br>
          <span style="font-size:0.78rem;color:#666">Assinatura do(a) Paciente / Responsável</span>
          ${data.dataAssinatura ? `<br><span style="font-size:0.75rem;color:#888">Data declarada: ${escapeHtml(data.dataAssinatura)}</span>` : ''}
        </div>

        <div class="sig-block">
          <div style="height:50px;display:flex;align-items:flex-end">
            <span style="font-family:'Cinzel',Georgia,serif;color:#1c3f2d;font-weight:bold;font-size:1.05rem">Dra. Fransuele Hanel</span>
          </div>
          <strong>Dra. Fransuele Hanel — CRBM-5 015427</strong><br>
          <span style="font-size:0.78rem;color:#666">Biomedicina Estética Avançada & Integrativa</span>
        </div>
      </div>

      <div class="no-print">
        <button onclick="window.print()" style="padding:12px 28px;background:#1c3f2d;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;box-shadow:0 4px 14px rgba(28,63,45,0.3)">
          🖨️ Imprimir / Salvar em PDF
        </button>
        <button onclick="window.close()" style="margin-left:12px;padding:12px 24px;background:#eee;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:1rem">
          Fechar
        </button>
      </div>
    </body>
    </html>
  `;

  res.send(html);
});

// ─── MÓDULO SIMULADOR DE PARCELAMENTO & PROPOSTAS ──────────────────
app.get('/admin/simulador', requireAuth, (req, res) => {
  const patients = db.prepare('SELECT id, full_name, phone FROM patients ORDER BY full_name ASC').all();
  const materials = db.prepare('SELECT * FROM material_costs WHERE is_active = 1 ORDER BY category ASC, name ASC').all();
  const cardRates = db.prepare('SELECT * FROM card_fee_rates ORDER BY installments ASC, id ASC').all();
  const clinicSettings = db.prepare('SELECT * FROM clinic_settings LIMIT 1').get() || {
    default_tax_pct: 6.0,
    default_card_fee_pct: 3.5,
    default_clinic_split_pct: 30.0
  };

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Precificação & WhatsApp</p>
        <h1>Simulador de Parcelamento & Lucro Líquido</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin/financeiro">💰 Ir para Financeiro</a>
        <a class="btn" href="/admin/materiais">🧪 Catálogo de Insumos</a>
        <a class="btn primary" href="/admin/agenda">📅 Agenda</a>
      </div>
    </header>

    ${renderAlert(req.query.saved ? 'Procedimento salvo com sucesso no prontuário da paciente!' : null, 'success')}
    ${renderAlert(req.query.error === 'no_patient' ? 'Selecione uma paciente cadastrada para salvar no prontuário.' : null, 'error')}

    <div class="sim-grid-layout">
      <!-- COLUNA DA ESQUERDA: Parâmetros & Insumos -->
      <div>
        <section class="panel">
          <h2 style="margin-top:0">1. Dados da Proposta / Procedimento</h2>
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
            <label class="field">
              <span>Valor Total Cobrado (R$) *</span>
              <input type="number" step="0.01" min="0" id="simGrossValue" placeholder="Ex.: 3000,00" value="3000" oninput="recalcSimulation()" style="font-size:1.15rem;font-weight:700;color:var(--accent)">
            </label>
            <label class="field">
              <span>Custo Extra de Insumos (R$)</span>
              <input type="number" step="0.01" min="0" id="simExtraMaterials" placeholder="0,00" value="0" oninput="recalcSimulation()">
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label class="field">
              <span>Procedimento / Protocolo</span>
              <input type="text" id="simDescription" placeholder="Ex.: Protocolo Elleva Smart + Lavieen" value="Protocolo Estético Personalizado" oninput="updateWhatsAppProposal()">
            </label>
            <label class="field">
              <span>Vincular Paciente (opcional)</span>
              <select id="simPatientSelect" onchange="onPatientSelectChange()">
                <option value="" data-phone="" data-name="Paciente">— Simulação Livre / Sem Vínculo —</option>
                ${patients.map(p => `<option value="${p.id}" data-phone="${escapeHtml(p.phone || '')}" data-name="${escapeHtml(p.full_name)}">${escapeHtml(p.full_name)}${p.phone ? ' (' + escapeHtml(p.phone) + ')' : ''}</option>`).join('')}
              </select>
            </label>
          </div>

          <!-- Alíquotas Configuradas -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
            <label class="field">
              <span>Imposto (%)</span>
              <input type="number" step="0.1" id="simTaxPct" value="${clinicSettings.default_tax_pct || 6.0}" oninput="recalcSimulation()">
            </label>
            <label class="field">
              <span>Repasse Clínica (%)</span>
              <input type="number" step="0.1" id="simClinicPct" value="${clinicSettings.default_clinic_split_pct || 30.0}" oninput="recalcSimulation()">
            </label>
          </div>

          <!-- Seletor de Insumos e Tecnologias -->
          <label class="field" style="margin-top:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-weight:600">Insumos, Materiais & Tecnologias Utilizados</span>
              <span class="muted" style="font-size:0.78rem" id="simMaterialsSelectedSummary">0 selecionados (R$ 0,00)</span>
            </div>
            <div class="materials-picker-container" style="max-height: 480px">
              ${renderMaterialsPickerHtml({ materials, prefix: 'sim', onchangeFn: 'recalcSimulation' })}
            </div>
          </label>
        </section>
      </div>

      <!-- COLUNA DA DIREITA: Tabela de Parcelamento, Extrato e WhatsApp -->
      <div>
        <!-- TABELA COMPARATIVA DE PARCELAS -->
        <section class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <h2 style="margin:0">2. Opções de Pagamento & Rentabilidade</h2>
            <span class="muted" style="font-size:0.8rem">Clique na linha para detalhar</span>
          </div>

          <!-- Filtros de Bandeira (Ton Black até 21x) -->
          <div style="display:flex;gap:6px;margin:10px 0 6px;flex-wrap:wrap">
            <button type="button" class="pay-shortcut-btn active" id="simFilterBtn_all" onclick="setSimBrandFilter('all')">
              Todas (${cardRates.length})
            </button>
            <button type="button" class="pay-shortcut-btn" id="simFilterBtn_visa_master" onclick="setSimBrandFilter('visa_master')">
              💳 Visa & Master (1x a 21x)
            </button>
            <button type="button" class="pay-shortcut-btn" id="simFilterBtn_elo_amex" onclick="setSimBrandFilter('elo_amex')">
              💳 Elo & Amex (1x a 21x)
            </button>
            <button type="button" class="pay-shortcut-btn" id="simFilterBtn_geral" onclick="setSimBrandFilter('geral')">
              🟢 Pix / Dinheiro (0%)
            </button>
          </div>

          <p class="muted" style="font-size:0.8rem;margin:4px 0 10px">
            Simulação completa com a dedução sequencial oficial (Cartão → Imposto 6% → Clínica 30% → Insumos = Lucro Fran):
          </p>

          <div class="table-wrap" style="max-height:380px;overflow-y:auto">
            <table class="sim-installments-table">
              <thead>
                <tr>
                  <th>Bandeira</th>
                  <th>Modalidade</th>
                  <th>Taxa</th>
                  <th>Parcela Paciente</th>
                  <th>Insumos</th>
                  <th>Lucro Fran</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody id="simInstallmentsBody">
                <!-- Gerado via Javascript -->
              </tbody>
            </table>
          </div>
        </section>

        <!-- EXTRATO DETALHADO (6 PASSOS) -->
        <section class="panel" style="margin-top:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="margin:0">3. Extrato da Condição Selecionada</h2>
            <span class="badge signed" id="simSelectedBadge">Pix à Vista</span>
          </div>

          <div class="step-card">
            <div class="step-badge">1</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>Faturamento Cobrado</span>
                <strong id="simLiveGross">R$ 0,00</strong>
              </div>
              <div class="step-info-sub" id="simLiveParcelaLabel">À vista (1x)</div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #f59e0b">
            <div class="step-badge" style="background:#f59e0b">2</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Taxa Cartão (<span id="simLiveCardPct">0.00</span>%)</span>
                <strong style="color:var(--danger)" id="simLiveCardFee">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Subtotal após taxa de cartão: <strong id="simLiveAfterCard" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #3b82f6">
            <div class="step-badge" style="background:#3b82f6">3</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Imposto (<span id="simLiveTaxPct">6.0</span>% pós-cartão)</span>
                <strong style="color:var(--danger)" id="simLiveTax">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Subtotal após imposto: <strong id="simLiveAfterTax" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #8b5cf6">
            <div class="step-badge" style="background:#8b5cf6">4</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Repasse Clínica (<span id="simLiveClinicPct">30.0</span>% pós-imposto)</span>
                <strong style="color:#9a3412" id="simLiveClinicSplit">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Cota Profissional Fran: <strong id="simLiveProfSubtotal" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #ef4444">
            <div class="step-badge" style="background:#ef4444">5</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Custo Insumos & Tecnologias</span>
                <strong style="color:var(--danger)" id="simLiveMaterials">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub" id="simLiveMaterialsCount">0 itens selecionados</div>
            </div>
          </div>

          <div class="receipt-total-profit" style="margin-top:14px">
            <div>
              <div style="font-size:0.75rem;letter-spacing:0.05em;text-transform:uppercase;opacity:0.9">6. LUCRO LÍQUIDO FINAL FRAN</div>
              <div style="font-size:0.82rem;font-weight:normal;opacity:0.9" id="simLiveMarginPct">Margem: 0%</div>
            </div>
            <span class="profit-badge" id="simLiveNetProfit" style="font-size:1.45rem">R$ 0,00</span>
          </div>
        </section>

        <!-- PROPOSTA WHATSAPP -->
        <section class="panel" style="margin-top:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <h2 style="margin:0">4. Proposta Pronta para WhatsApp</h2>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn tiny primary" onclick="copyWhatsAppProposal()">📋 Copiar Proposta</button>
              <button type="button" class="btn tiny" id="btnSendWhatsApp" onclick="openWhatsApp()" style="background:#25d366;color:#fff;display:none">💬 Enviar WhatsApp</button>
            </div>
          </div>

          <div class="whatsapp-copy-box" id="simWhatsAppBox"></div>
          <div id="copyFeedback" style="display:none;margin-top:8px;color:#15803d;font-weight:600;font-size:0.85rem">
            ✅ Proposta copiada para a área de transferência! Cole diretamente no WhatsApp da paciente.
          </div>
        </section>

        <!-- SALVAR NO PRONTUÁRIO (SE PACIENTE SELECIONADA) -->
        <section class="panel" id="saveToPatientSection" style="margin-top:20px;display:none;background:#f0fdf4;border:1px solid #86efac">
          <h3 style="margin:0 0 8px;color:#166534">💾 Salvar no Histórico Financeiro da Paciente</h3>
          <p style="margin:0 0 12px;font-size:0.84rem;color:#15803d">
            Deseja lançar este procedimento e os insumos diretamente na pasta de <strong id="savePatientName">Paciente</strong>?
          </p>
          <form method="post" action="/admin/simulador/save" id="simSaveForm">
            <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
            <input type="hidden" name="patient_id" id="savePatientId" value="">
            <input type="hidden" name="description" id="saveDescription" value="">
            <input type="hidden" name="gross_value" id="saveGrossValue" value="">
            <input type="hidden" name="extra_materials" id="saveExtraMaterials" value="">
            <input type="hidden" name="payment_method" id="savePaymentMethod" value="pix">
            <input type="hidden" name="installments" id="saveInstallments" value="1">
            <input type="hidden" name="tax_pct" id="saveTaxPct" value="6.0">
            <input type="hidden" name="card_fee_pct" id="saveCardFeePct" value="0">
            <input type="hidden" name="clinic_split_pct" id="saveClinicSplitPct" value="30.0">
            <input type="hidden" name="materials_json" id="saveMaterialsJson" value="[]">
            <button type="submit" class="btn primary" style="width:100%">💾 Confirmar e Lançar no Prontuário</button>
          </form>
        </section>
      </div>
    </div>

    <script>
      var cardRatesData = ${JSON.stringify(cardRates)};
      var simCurrentBrandFilter = 'all';
      var selectedMethodCode = 'pix';
      var currentProposalText = '';

      function formatMoney(val) {
        return (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      function setSimBrandFilter(brand) {
        simCurrentBrandFilter = brand;
        ['all', 'visa_master', 'elo_amex', 'geral'].forEach(function(b) {
          var btn = document.getElementById('simFilterBtn_' + b);
          if (btn) {
            if (b === brand) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        });
        recalcSimulation();
      }

      ${renderMaterialsPickerScript('sim', 'recalcSimulation')}

      function selectRateMethod(code) {
        selectedMethodCode = code;
        recalcSimulation();
      }

      function onPatientSelectChange() {
        var sel = document.getElementById('simPatientSelect');
        var opt = sel.options[sel.selectedIndex];
        var pid = opt.value;
        var pname = opt.dataset.name || 'Paciente';
        var phone = opt.dataset.phone || '';

        var saveSec = document.getElementById('saveToPatientSection');
        var saveName = document.getElementById('savePatientName');
        var savePid = document.getElementById('savePatientId');
        var btnWa = document.getElementById('btnSendWhatsApp');

        if (pid) {
          if (saveSec) saveSec.style.display = 'block';
          if (saveName) saveName.textContent = pname;
          if (savePid) savePid.value = pid;
          if (btnWa) {
            btnWa.style.display = phone ? 'inline-block' : 'none';
          }
        } else {
          if (saveSec) saveSec.style.display = 'none';
          if (savePid) savePid.value = '';
          if (btnWa) btnWa.style.display = 'none';
        }
        updateWhatsAppProposal();
      }

      function recalcSimulation() {
        var gross = parseFloat(document.getElementById('simGrossValue').value) || 0;
        var extraMat = parseFloat(document.getElementById('simExtraMaterials').value) || 0;
        var taxPct = parseFloat(document.getElementById('simTaxPct').value) || 0;
        var clinicPct = parseFloat(document.getElementById('simClinicPct').value) || 0;

        // Soma materiais selecionados
        var catalogMatCost = 0;
        var selectedCount = 0;
        var selectedMaterials = [];
        document.querySelectorAll('.sim-mat-qty').forEach(function(input) {
          var qty = parseFloat(input.value) || 0;
          if (qty > 0) {
            var id = input.dataset.id;
            var cost = parseFloat(input.dataset.cost) || 0;
            var totalItem = qty * cost;
            var cb = document.querySelector('.sim-mat-checkbox[data-id="' + id + '"]');
            var name = cb ? cb.dataset.name : ('Item ' + id);
            catalogMatCost += totalItem;
            selectedCount++;
            selectedMaterials.push({ id: id, name: name, cost: cost, qty: qty, total: totalItem });
          }
        });

        var totalMaterials = catalogMatCost + extraMat;
        var summaryElem = document.getElementById('simMaterialsSelectedSummary');
        if (summaryElem) {
          summaryElem.textContent = selectedCount + ' item(ns) (R$ ' + formatMoney(totalMaterials) + ')';
        }

        // Renderiza linhas da tabela de parcelas
        var tbody = document.getElementById('simInstallmentsBody');
        var rowsHtml = '';
        var selectedRateObj = null;

        cardRatesData.forEach(function(rate) {
          var rBrand = rate.brand || 'geral';
          var isMatch = (simCurrentBrandFilter === 'all') || (rBrand === simCurrentBrandFilter);

          var isSel = rate.method_code === selectedMethodCode;
          if (isSel) selectedRateObj = rate;

          if (!isMatch) return;

          var cardFeeAmount = gross * (rate.fee_pct / 100);
          var valAfterCard = Math.max(0, gross - cardFeeAmount);
          var taxAmount = valAfterCard * (taxPct / 100);
          var valAfterTax = Math.max(0, valAfterCard - taxAmount);
          var clinicAmount = valAfterTax * (clinicPct / 100);
          var profSubtotal = Math.max(0, valAfterTax - clinicAmount);
          var netProfit = profSubtotal - totalMaterials;
          var marginPct = gross > 0 ? ((netProfit / gross) * 100).toFixed(1) : '0';

          var parcelaVal = rate.installments > 0 ? (gross / rate.installments) : gross;
          var parcelaText = rate.installments > 1
            ? rate.installments + 'x de R$ ' + formatMoney(parcelaVal)
            : 'R$ ' + formatMoney(gross);

          var profitColor = netProfit < 0 ? '#dc2626' : '#15803d';

          var brandBadge = '';
          if (rate.brand === 'visa_master') {
            brandBadge = '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:0.75rem">Visa / Master</span>';
          } else if (rate.brand === 'elo_amex') {
            brandBadge = '<span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.75rem">Elo / Amex</span>';
          } else {
            brandBadge = '<span class="badge signed" style="font-size:0.75rem">À Vista</span>';
          }

          rowsHtml += '<tr class="' + (isSel ? 'selected' : '') + '" style="cursor:pointer" onclick="selectRateMethod(\\'' + rate.method_code + '\\')">' +
            '<td>' + brandBadge + '</td>' +
            '<td><strong>' + rate.label + '</strong></td>' +
            '<td>' + (rate.fee_pct > 0 ? (rate.fee_pct.toFixed(2).replace('.', ',') + '%') : '<span class="badge signed">0%</span>') + '</td>' +
            '<td><strong>' + parcelaText + '</strong></td>' +
            '<td style="color:var(--danger)">- R$ ' + formatMoney(totalMaterials) + '</td>' +
            '<td style="color:' + profitColor + ';font-weight:700">R$ ' + formatMoney(netProfit) + '</td>' +
            '<td><span style="font-size:0.8rem;opacity:0.85">' + marginPct + '%</span></td>' +
          '</tr>';
        });

        if (tbody) tbody.innerHTML = rowsHtml;

        // Se a opção selecionada não existe mais, pega a primeira
        if (!selectedRateObj && cardRatesData.length) {
          selectedRateObj = cardRatesData[0];
          selectedMethodCode = selectedRateObj.method_code;
        }

        if (selectedRateObj) {
          var selCardFee = gross * (selectedRateObj.fee_pct / 100);
          var selAfterCard = Math.max(0, gross - selCardFee);
          var selTax = selAfterCard * (taxPct / 100);
          var selAfterTax = Math.max(0, selAfterCard - selTax);
          var selClinic = selAfterTax * (clinicPct / 100);
          var selProf = Math.max(0, selAfterTax - selClinic);
          var selNet = selProf - totalMaterials;
          var selMargin = gross > 0 ? ((selNet / gross) * 100).toFixed(1) : '0';

          // Atualiza Extrato
          var bBadge = document.getElementById('simSelectedBadge');
          if (bBadge) bBadge.textContent = selectedRateObj.label;

          var lg = document.getElementById('simLiveGross');
          if (lg) lg.textContent = 'R$ ' + formatMoney(gross);

          var lp = document.getElementById('simLiveParcelaLabel');
          if (lp) {
            var part = selectedRateObj.installments > 1 ? (gross / selectedRateObj.installments) : gross;
            lp.textContent = selectedRateObj.installments > 1
              ? (selectedRateObj.installments + 'x de R$ ' + formatMoney(part))
              : 'À vista';
          }

          var lcp = document.getElementById('simLiveCardPct');
          if (lcp) lcp.textContent = selectedRateObj.fee_pct.toFixed(2);
          var lcf = document.getElementById('simLiveCardFee');
          if (lcf) lcf.textContent = '- R$ ' + formatMoney(selCardFee);
          var lac = document.getElementById('simLiveAfterCard');
          if (lac) lac.textContent = 'R$ ' + formatMoney(selAfterCard);

          var ltp = document.getElementById('simLiveTaxPct');
          if (ltp) ltp.textContent = taxPct.toFixed(1);
          var lt = document.getElementById('simLiveTax');
          if (lt) lt.textContent = '- R$ ' + formatMoney(selTax);
          var lat = document.getElementById('simLiveAfterTax');
          if (lat) lat.textContent = 'R$ ' + formatMoney(selAfterTax);

          var lclp = document.getElementById('simLiveClinicPct');
          if (lclp) lclp.textContent = clinicPct.toFixed(1);
          var lcl = document.getElementById('simLiveClinicSplit');
          if (lcl) lcl.textContent = '- R$ ' + formatMoney(selClinic);
          var lps = document.getElementById('simLiveProfSubtotal');
          if (lps) lps.textContent = 'R$ ' + formatMoney(selProf);

          var lm = document.getElementById('simLiveMaterials');
          if (lm) lm.textContent = '- R$ ' + formatMoney(totalMaterials);
          var lmc = document.getElementById('simLiveMaterialsCount');
          if (lmc) lmc.textContent = selectedCount + ' item(ns) selecionado(s)' + (extraMat > 0 ? ' + extra' : '');

          var lnp = document.getElementById('simLiveNetProfit');
          if (lnp) {
            lnp.textContent = 'R$ ' + formatMoney(selNet);
            if (selNet < 0) {
              lnp.style.background = '#fef2f2';
              lnp.style.color = '#dc2626';
            } else {
              lnp.style.background = '#f0fdf4';
              lnp.style.color = '#15803d';
            }
          }

          var lmp = document.getElementById('simLiveMarginPct');
          if (lmp) lmp.textContent = 'Margem Líquida: ' + selMargin + '%';

          // Atualiza dados no form de salvar no prontuário
          var descInput = document.getElementById('simDescription');
          var descVal = descInput ? descInput.value.trim() : 'Procedimento Clínico';

          var sDesc = document.getElementById('saveDescription');
          if (sDesc) sDesc.value = descVal;
          var sGross = document.getElementById('saveGrossValue');
          if (sGross) sGross.value = gross.toFixed(2);
          var sExtra = document.getElementById('saveExtraMaterials');
          if (sExtra) sExtra.value = extraMat.toFixed(2);
          var sMethod = document.getElementById('savePaymentMethod');
          if (sMethod) sMethod.value = selectedRateObj.method_code;
          var sInst = document.getElementById('saveInstallments');
          if (sInst) sInst.value = selectedRateObj.installments;
          var sTax = document.getElementById('saveTaxPct');
          if (sTax) sTax.value = taxPct.toFixed(2);
          var sCard = document.getElementById('saveCardFeePct');
          if (sCard) sCard.value = selectedRateObj.fee_pct.toFixed(2);
          var sClin = document.getElementById('saveClinicSplitPct');
          if (sClin) sClin.value = clinicPct.toFixed(2);
          var sMat = document.getElementById('saveMaterialsJson');
          if (sMat) sMat.value = JSON.stringify(selectedMaterials);
        }

        updateWhatsAppProposal();
      }

      function updateWhatsAppProposal() {
        var gross = parseFloat(document.getElementById('simGrossValue').value) || 0;
        var descInput = document.getElementById('simDescription');
        var desc = descInput ? descInput.value.trim() : 'Protocolo Estético Personalizado';

        var sel = document.getElementById('simPatientSelect');
        var opt = sel ? sel.options[sel.selectedIndex] : null;
        var patientName = (opt && opt.value) ? opt.dataset.name : 'Paciente';

        // Tabela de parcelas para o texto do WhatsApp (Visa/Master e Elo/Amex)
        var vmRates = cardRatesData.filter(function(r) { return r.brand === 'visa_master' && r.installments > 0; });
        var keyInstallments = [1, 2, 3, 4, 5, 6, 10, 12];
        var vmFiltered = vmRates.filter(function(r) { return keyInstallments.indexOf(r.installments) !== -1; });
        if (!vmFiltered.length) vmFiltered = vmRates.slice(0, 12);

        var linesParcelas = '';
        vmFiltered.forEach(function(r) {
          var part = gross / r.installments;
          linesParcelas += '• ' + r.installments + 'x de R$ ' + formatMoney(part) + '\\n';
        });

        var text = '✨ *Proposta de Tratamento Personalizada* ✨\\n' +
          '*Dra. Fransuele Hanel • Biomedicina Estética Avançada*\\n\\n' +
          'Olá, *' + patientName + '*! Foi um prazer atender você.\\n' +
          'Preparamos com muito carinho a sua proposta para o seu *' + desc + '*:\\n\\n' +
          '💎 *CONDIÇÃO ESPECIAL À VISTA (Pix / Dinheiro):*\\n' +
          '👉 *R$ ' + formatMoney(gross) + '*\\n\\n' +
          '💳 *OPÇÕES NO CARTÃO (Visa & Mastercard):*\\n' +
          linesParcelas + '\\n' +
          '*(Também parcelamos em até 21x e aceitamos bandeiras Elo e American Express)*\\n\\n' +
          '📍 Atendimento personalizado com insumos nobres e tecnologias exclusivas.\\n' +
          'Ficou com alguma dúvida ou gostaria de agendar a sua sessão?';

        currentProposalText = text;
        var box = document.getElementById('simWhatsAppBox');
        if (box) {
          box.textContent = text.replace(/\\\\n/g, '\\n');
        }
      }

      function copyWhatsAppProposal() {
        var plain = currentProposalText.replace(/\\\\n/g, '\\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plain).then(function() {
            showCopyFeedback();
          }).catch(function() {
            fallbackCopy(plain);
          });
        } else {
          fallbackCopy(plain);
        }
      }

      function fallbackCopy(str) {
        var ta = document.createElement('textarea');
        ta.value = str;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showCopyFeedback();
      }

      function showCopyFeedback() {
        var fb = document.getElementById('copyFeedback');
        if (fb) {
          fb.style.display = 'block';
          setTimeout(function() { fb.style.display = 'none'; }, 4000);
        }
      }

      function openWhatsApp() {
        var sel = document.getElementById('simPatientSelect');
        var opt = sel.options[sel.selectedIndex];
        var phone = opt.dataset.phone || '';
        if (!phone) {
          alert('Esta paciente não possui número de telefone/WhatsApp cadastrado.');
          return;
        }
        var cleanPhone = phone.replace(/\\D/g, '');
        if (!cleanPhone.startsWith('55') && cleanPhone.length <= 11) {
          cleanPhone = '55' + cleanPhone;
        }
        var plain = currentProposalText.replace(/\\\\n/g, '\\n');
        var url = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(plain);
        window.open(url, '_blank');
      }

      window.addEventListener('DOMContentLoaded', function() {
        recalcSimulation();
      });
    </script>
  `;

  res.send(layout({ title: 'Simulador de Parcelamento', body, userEmail: req.session.adminEmail, activeNav: 'simulador' }));
});

app.post('/admin/simulador/save', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.body.patient_id);
  if (!patientId) {
    res.redirect('/admin/simulador?error=no_patient');
    return;
  }
  const description = String(req.body.description || '').trim() || 'Procedimento Clínico';
  const grossValue = parseFloat(req.body.gross_value) || 0;
  const extraMaterials = parseFloat(req.body.extra_materials) || 0;
  const paymentMethod = String(req.body.payment_method || 'pix').trim();
  const installments = Math.max(1, parseInt(req.body.installments) || 1);
  const taxPct = parseFloat(req.body.tax_pct) || 0;
  const cardFeePct = parseFloat(req.body.card_fee_pct) || 0;
  const clinicSplitPct = parseFloat(req.body.clinic_split_pct) || 0;

  const materialsJson = String(req.body.materials_json || '[]');
  let catalogMatCost = 0;
  try {
    const list = JSON.parse(materialsJson);
    catalogMatCost = list.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  } catch (_e) {}

  const materialsCost = catalogMatCost + extraMaterials;
  const calc = calculateProcedureProfit({
    grossValue,
    cardFeePct,
    taxPct,
    clinicSplitPct,
    materialsCost
  });

  db.prepare(`
    INSERT INTO procedure_financials (
      patient_id, description, payment_method, installments,
      gross_value, materials_cost, materials_json,
      card_fee_pct, card_fee_amount, value_after_card,
      tax_pct, tax_amount, value_after_tax,
      clinic_split_pct, clinic_split_amount, professional_subtotal,
      net_profit, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId, description, paymentMethod, installments,
    calc.grossValue, calc.materialsCost, materialsJson,
    calc.cardFeePct, calc.cardFeeAmount, calc.valueAfterCard,
    calc.taxPct, calc.taxAmount, calc.valueAfterTax,
    calc.clinicSplitPct, calc.clinicSplitAmount, calc.professionalSubtotal,
    calc.netProfit, nowIso()
  );

  res.redirect(`/admin/patients/${patientId}?saved_financial=1#financeiro`);
});

// ─── MÓDULO FINANCEIRO & RENTABILIDADE CLÍNICA ─────────────────────────────
app.get('/admin/financeiro', requireAuth, (req, res) => {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const dateFrom = String(req.query.dateFrom || `${currentMonthKey}-01`).slice(0, 10);
  const dateTo = String(req.query.dateTo || `${currentMonthKey}-${String(lastDay).padStart(2, '0')}`).slice(0, 10);

  const totals = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_procedures,
        COALESCE(SUM(gross_value), 0) AS total_gross,
        COALESCE(SUM(materials_cost), 0) AS total_materials,
        COALESCE(SUM(tax_amount), 0) AS total_tax,
        COALESCE(SUM(card_fee_amount), 0) AS total_card_fee,
        COALESCE(SUM(clinic_split_amount), 0) AS total_clinic_split,
        COALESCE(SUM(net_profit), 0) AS total_net_profit
      FROM procedure_financials
      WHERE date(created_at) BETWEEN ? AND ?
      `
    )
    .get(dateFrom, dateTo);

  const entries = db
    .prepare(
      `
      SELECT pf.*, p.full_name AS patient_name, p.patient_code
      FROM procedure_financials pf
      LEFT JOIN patients p ON p.id = pf.patient_id
      WHERE date(pf.created_at) BETWEEN ? AND ?
      ORDER BY pf.created_at DESC
      `
    )
    .all(dateFrom, dateTo);

  const patients = db.prepare('SELECT id, patient_code, full_name FROM patients ORDER BY full_name ASC').all();
  const materials = db.prepare('SELECT * FROM material_costs WHERE is_active = 1 ORDER BY category ASC, name ASC').all();
  const cardRates = db.prepare('SELECT * FROM card_fee_rates ORDER BY installments ASC, id ASC').all();
  const vmRates = cardRates.filter((r) => r.brand === 'visa_master');
  const eloRates = cardRates.filter((r) => r.brand === 'elo_amex');
  const generalRates = cardRates.filter((r) => !r.brand || r.brand === 'geral');
  const clinicSettings = db.prepare('SELECT * FROM clinic_settings LIMIT 1').get() || {
    default_tax_pct: 6.0,
    default_card_fee_pct: 3.5,
    default_clinic_split_pct: 30.0
  };

  const patientOptions = patients
    .map((p) => `<option value="${p.id}">${escapeHtml(toCodeNumber(p.patient_code))} - ${escapeHtml(p.full_name)}</option>`)
    .join('');

  const rows = entries.length
    ? entries
        .map((e) => {
          const payLabel = e.payment_method ? e.payment_method.toUpperCase().replace('_', ' ') : 'PIX';
          const instLabel = e.installments && e.installments > 1 ? ` (${e.installments}x)` : '';
          return `
            <tr>
              <td>${escapeHtml(formatDateTime(e.created_at))}</td>
              <td>${e.patient_name ? `<a href="/admin/patients/${e.patient_id}"><strong>${escapeHtml(e.patient_name)}</strong></a>` : '<span class="muted">Avulso</span>'}</td>
              <td>
                <strong>${escapeHtml(e.description)}</strong>
                <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(payLabel + instLabel)}</div>
              </td>
              <td><strong>R$ ${escapeHtml(formatBRL(e.gross_value))}</strong></td>
              <td style="color:var(--danger)">- R$ ${escapeHtml(formatBRL(e.materials_cost))}</td>
              <td style="color:var(--muted)">- R$ ${escapeHtml(formatBRL(e.card_fee_amount))} (${e.card_fee_pct}%)</td>
              <td style="color:#b45309">- R$ ${escapeHtml(formatBRL(e.tax_amount))} (6%)</td>
              <td style="color:#9a3412">- R$ ${escapeHtml(formatBRL(e.clinic_split_amount))} (30%)</td>
              <td style="color:#15803d;font-weight:700;font-size:0.95rem">R$ ${escapeHtml(formatBRL(e.net_profit))}</td>
              <td>
                <form method="post" action="/admin/financial/${e.id}/delete" onsubmit="return confirm('Excluir este lançamento financeiro?')" style="margin:0">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <input type="hidden" name="returnUrl" value="/admin/financeiro?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}">
                  <button class="btn tiny danger" type="submit">Excluir</button>
                </form>
              </td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="10" class="muted">Nenhum procedimento registrado no período selecionado.</td></tr>';

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Gestão Financeira</p>
        <h1>Custos, Repasses e Lucro Líquido</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin/simulador">🧮 Abrir Simulador</a>
        <a class="btn" href="/admin/materiais">🧪 Gerenciar Insumos & Materiais</a>
        <a class="btn primary" href="/admin/agenda">📅 Agenda</a>
      </div>
    </header>

    ${renderAlert(req.query.saved ? 'Registro financeiro salvo com sucesso!' : null, 'success')}
    ${renderAlert(req.query.settings_saved ? 'Alíquotas padrão atualizadas com sucesso!' : null, 'success')}
    ${renderAlert(req.query.rates_saved ? 'Taxas de cartão atualizadas com sucesso!' : null, 'success')}
    ${renderAlert(req.query.deleted ? 'Registro financeiro excluído.' : null, 'info')}

    <!-- Filtro de Período -->
    <section class="panel">
      <form method="get" action="/admin/financeiro" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-weight:700;font-size:0.9rem;color:var(--text)">Filtrar por período:</span>
        <div class="date-time-pair" style="max-width:320px">
          <input type="date" name="dateFrom" value="${escapeHtml(dateFrom)}">
          <input type="date" name="dateTo" value="${escapeHtml(dateTo)}">
        </div>
        <button class="btn primary" type="submit">Filtrar</button>
        <a class="btn ghost" href="/admin/financeiro">Mês Atual</a>
      </form>
    </section>

    <!-- Indicadores Principais (KPIs) -->
    <div class="kpi-row">
      <article class="kpi-card">
        <span>Faturamento Bruto</span>
        <strong>R$ ${escapeHtml(formatBRL(totals.total_gross))}</strong>
        <span style="font-size:0.75rem;margin-top:2px">${totals.total_procedures} atendimentos</span>
      </article>

      <article class="kpi-card">
        <span>Custo de Materiais</span>
        <strong style="color:var(--danger)">- R$ ${escapeHtml(formatBRL(totals.total_materials))}</strong>
        <span style="font-size:0.75rem;margin-top:2px">Insumos aplicados</span>
      </article>

      <article class="kpi-card">
        <span>Impostos & Cartão</span>
        <strong style="color:var(--muted)">- R$ ${escapeHtml(formatBRL(totals.total_tax + totals.total_card_fee))}</strong>
        <span style="font-size:0.75rem;margin-top:2px">Taxas operacionais</span>
      </article>

      <article class="kpi-card">
        <span>Repasse para Clínica</span>
        <strong style="color:#9a3412">- R$ ${escapeHtml(formatBRL(totals.total_clinic_split))}</strong>
        <span style="font-size:0.75rem;margin-top:2px">Espaço / Comissão</span>
      </article>

      <article class="kpi-card highlight">
        <span>LUCRO LÍQUIDO FRAN</span>
        <strong>R$ ${escapeHtml(formatBRL(totals.total_net_profit))}</strong>
        <span style="font-size:0.75rem;margin-top:2px">Rentabilidade real</span>
      </article>
    </div>

    <!-- Calculadora e Novo Lançamento -->
    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <h2 style="margin:0">Novo Registro / Calculadora de Procedimento</h2>
          <p class="muted" style="margin:4px 0 0;font-size:0.84rem">
            Selecione a paciente, descreva o procedimento e marque os materiais para calcular os repasses e lucro na hora.
          </p>
        </div>
      </div>

      <div class="calc-container">
        <div class="calc-inputs-card">
          <form method="post" action="/admin/financeiro/entry" id="mainCalcForm">
            <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
            <input type="hidden" name="materials_json" id="mainCalcMaterialsJson" value="[]">
            <input type="hidden" name="tax_amount" id="mainCalcTaxAmount" value="0">
            <input type="hidden" name="card_fee_amount" id="mainCalcCardFeeAmount" value="0">
            <input type="hidden" name="clinic_split_amount" id="mainCalcClinicSplitAmount" value="0">
            <input type="hidden" name="net_profit" id="mainCalcNetProfitHidden" value="0">

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label class="field">
                <span>Paciente (opcional)</span>
                <select name="patientId">
                  <option value="">— Sem paciente vinculado (Avulso) —</option>
                  ${patientOptions}
                </select>
              </label>

              <label class="field">
                <span>Descrição do Procedimento *</span>
                <input type="text" name="description" placeholder="Ex.: Toxina Botulínica 50U + Preenchimento Malar" required>
              </label>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label class="field">
                <span>Valor Cobrado da Paciente (R$) *</span>
                <input type="number" step="0.01" min="0" name="gross_value" id="mainCalcGross" placeholder="1500,00" required oninput="recalcMainProfit()">
              </label>
              <label class="field">
                <span>Custo Extra de Insumos (R$)</span>
                <input type="number" step="0.01" min="0" name="extra_materials" id="mainCalcExtraMat" placeholder="0,00" oninput="recalcMainProfit()">
              </label>
            </div>

            <div class="payment-brands-container">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
                <span style="font-weight:700;font-size:0.9rem;color:var(--text)">Forma de Pagamento da Paciente *</span>
                <span style="font-size:0.8rem;color:var(--accent);font-weight:600" id="mainSelectedPaymentLabel">Selecionado: Pix à Vista (0%)</span>
              </div>

              <!-- Atalhos rápidos À Vista -->
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
                <button type="button" class="pay-shortcut-btn active" id="mainBtnPix" onclick="selectMainDirectPayment('pix', 0, 1, 'Pix à Vista')">
                  🟢 Pix à Vista (0%)
                </button>
                <button type="button" class="pay-shortcut-btn" id="mainBtnDinheiro" onclick="selectMainDirectPayment('dinheiro', 0, 1, 'Dinheiro à Vista')">
                  💵 Dinheiro à Vista (0%)
                </button>
              </div>

              <!-- Dois campos dedicados por bandeira (Ton Black até 21x) -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label class="field brand-select-field" style="margin:0">
                  <span style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text)">
                    <span>💳</span> Visa & Mastercard (1x a 21x)
                  </span>
                  <select id="mainPayVisaMaster" onchange="selectMainBrandOption(this, 'visa_master')">
                    <option value="">Selecione opção Visa / Master...</option>
                    ${vmRates.map((r) => `
                      <option value="${escapeHtml(r.method_code)}" data-fee="${r.fee_pct}" data-installments="${r.installments}" data-label="${escapeHtml(r.label)}">
                        ${escapeHtml(r.label)} — ${r.fee_pct.toFixed(2).replace('.', ',')}%
                      </option>
                    `).join('')}
                  </select>
                </label>

                <label class="field brand-select-field" style="margin:0">
                  <span style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text)">
                    <span>💳</span> Elo & American Express (1x a 21x)
                  </span>
                  <select id="mainPayEloAmex" onchange="selectMainBrandOption(this, 'elo_amex')">
                    <option value="">Selecione opção Elo / Amex...</option>
                    ${eloRates.map((r) => `
                      <option value="${escapeHtml(r.method_code)}" data-fee="${r.fee_pct}" data-installments="${r.installments}" data-label="${escapeHtml(r.label)}">
                        ${escapeHtml(r.label)} — ${r.fee_pct.toFixed(2).replace('.', ',')}%
                      </option>
                    `).join('')}
                  </select>
                </label>
              </div>

              <!-- Inputs hidden para persistência no banco -->
              <input type="hidden" name="payment_method" id="mainPaymentMethod" value="pix">
              <input type="hidden" name="installments" id="mainInstallments" value="1">
            </div>

            <label class="field">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span>Insumos, Materiais & Tecnologias Utilizados</span>
                <span class="muted" style="font-size:0.78rem">Selecione e ajuste as quantidades</span>
              </div>
              <div class="materials-picker-container">
                ${renderMaterialsPickerHtml({ materials, prefix: 'main', onchangeFn: 'recalcMainProfit' })}
              </div>
            </label>

            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-top:10px">
              <label class="field">
                <span>Taxa Cartão (%)</span>
                <input type="number" step="0.01" name="card_fee_pct" id="mainCardPct" value="0.00" oninput="recalcMainProfit()">
              </label>
              <label class="field">
                <span>Imposto (%)</span>
                <input type="number" step="0.1" name="tax_pct" id="mainTaxPct" value="${clinicSettings.default_tax_pct || 6.0}" oninput="recalcMainProfit()">
              </label>
              <label class="field">
                <span>Repasse Clínica (%)</span>
                <input type="number" step="0.1" name="clinic_split_pct" id="mainClinicPct" value="${clinicSettings.default_clinic_split_pct || 30.0}" oninput="recalcMainProfit()">
              </label>
            </div>

            <div style="margin-top:16px">
              <button class="btn primary" type="submit">💾 Salvar Lançamento Financeiro</button>
            </div>
          </form>
        </div>

        <!-- Recibo em Tempo Real (6 Passos) -->
        <div class="calc-receipt-card">
          <h3 class="calc-receipt-title">Extrato do Atendimento (6 Passos)</h3>

          <div class="step-card">
            <div class="step-badge">1</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>Faturamento Cobrado</span>
                <strong id="mainLiveGross">R$ 0,00</strong>
              </div>
              <div class="step-info-sub" id="mainLiveParcelaLabel">À vista (Pix)</div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #f59e0b">
            <div class="step-badge" style="background:#f59e0b">2</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Taxa Cartão (<span id="mainLiveCardPct">0.00</span>%)</span>
                <strong style="color:var(--danger)" id="mainLiveCardFee">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Subtotal após taxa: <strong id="mainLiveAfterCard" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #3b82f6">
            <div class="step-badge" style="background:#3b82f6">3</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Imposto (<span id="mainLiveTaxPct">6.0</span>% pós-cartão)</span>
                <strong style="color:var(--danger)" id="mainLiveTax">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Subtotal após imposto: <strong id="mainLiveAfterTax" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #8b5cf6">
            <div class="step-badge" style="background:#8b5cf6">4</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Repasse Clínica (<span id="mainLiveClinicPct">30.0</span>% pós-imposto)</span>
                <strong style="color:#9a3412" id="mainLiveClinicSplit">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub">Cota Profissional Fran: <strong id="mainLiveProfSubtotal" style="color:var(--text)">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="step-card" style="border-left: 3px solid #ef4444">
            <div class="step-badge" style="background:#ef4444">5</div>
            <div class="step-info">
              <div class="step-info-header">
                <span>(-) Custo Insumos & Tecnologias</span>
                <strong style="color:var(--danger)" id="mainLiveMaterials">- R$ 0,00</strong>
              </div>
              <div class="step-info-sub" id="mainLiveMaterialsCount">0 itens selecionados</div>
            </div>
          </div>

          <div class="receipt-total-profit" style="margin-top:12px">
            <div>
              <div style="font-size:0.75rem;letter-spacing:0.05em;text-transform:uppercase;opacity:0.9">6. LUCRO LÍQUIDO FINAL FRAN</div>
              <div style="font-size:0.8rem;font-weight:normal;opacity:0.9" id="mainLiveMarginPct">Margem: 0%</div>
            </div>
            <span class="profit-badge" id="mainLiveNetProfit" style="font-size:1.45rem">R$ 0,00</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Tabela de Lançamentos do Período -->
    <section class="panel">
      <h2>Procedimentos Registrados no Período</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Paciente</th>
              <th>Procedimento / Pgto</th>
              <th>Valor Bruto</th>
              <th>Insumos</th>
              <th>Taxa Cartão</th>
              <th>Imposto 6%</th>
              <th>Repasse Clínica 30%</th>
              <th>Lucro Líquido</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      <!-- Configuração de Alíquotas Padrão -->
      <section class="panel">
        <h2>Alíquotas Padrão da Clínica</h2>
        <p class="muted" style="font-size:0.86rem;margin-top:4px">
          Valores sugeridos automaticamente ao abrir a calculadora de procedimentos.
        </p>
        <form class="form-stack" method="post" action="/admin/financeiro/settings" style="margin-top:14px">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px">
            <label class="field">
              <span>Imposto Padrão (%)</span>
              <input type="number" step="0.1" name="default_tax_pct" value="${clinicSettings.default_tax_pct || 6.0}" required>
            </label>
            <label class="field">
              <span>Taxa Cartão Padrão (%)</span>
              <input type="number" step="0.1" name="default_card_fee_pct" value="${clinicSettings.default_card_fee_pct || 3.5}" required>
            </label>
            <label class="field">
              <span>Repasse Clínica (%)</span>
              <input type="number" step="0.1" name="default_clinic_split_pct" value="${clinicSettings.default_clinic_split_pct || 30.0}" required>
            </label>
          </div>
          <button class="btn primary" type="submit">Salvar Alíquotas Padrão</button>
        </form>
      </section>

      <!-- Taxas das Maquininhas de Cartão (Ton Black) -->
      <section class="panel" id="taxas-cartao">
        <h2>💳 Taxas das Maquininhas de Cartão (Ton Black)</h2>
        <p class="muted" style="font-size:0.86rem;margin-top:4px">
          Configure as taxas oficiais de parcelamento da Ton Black (R$ 20 mil a R$ 40 mil / 1 dia útil). Elas alimentam o Simulador, as Fichas de Procedimento e o Cálculo de Lucro Líquido.
        </p>
        <form class="form-stack" method="post" action="/admin/financeiro/card-rates" style="margin-top:14px">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">

          <!-- Seção 1: Visa & Mastercard -->
          <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;padding:14px;background:#f8fafc">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="font-size:1.1rem">💳</span>
              <strong style="color:var(--text);font-size:0.95rem">1. Visa & Mastercard (1ª Coluna - Débito e Crédito 1x a 21x)</strong>
              <span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:0.75rem">${vmRates.length} taxas</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:8px">
              ${vmRates.map((r) => `
                <label class="field" style="margin:0">
                  <span style="font-size:0.78rem;font-weight:600">${escapeHtml(r.label.replace(' (Visa/Master)', ''))}</span>
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" step="0.01" min="0" name="rates[${escapeHtml(r.method_code)}]" value="${r.fee_pct}" style="text-align:right;padding:4px 6px;font-size:0.85rem" required>
                    <span style="font-weight:bold;color:var(--muted);font-size:0.8rem">%</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Seção 2: Elo & American Express -->
          <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;padding:14px;background:#fffbeb">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="font-size:1.1rem">💳</span>
              <strong style="color:var(--text);font-size:0.95rem">2. Elo & American Express (2ª Coluna - Débito e Crédito 1x a 21x)</strong>
              <span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.75rem">${eloRates.length} taxas</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:8px">
              ${eloRates.map((r) => `
                <label class="field" style="margin:0">
                  <span style="font-size:0.78rem;font-weight:600">${escapeHtml(r.label.replace(' (Elo/Amex)', ''))}</span>
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" step="0.01" min="0" name="rates[${escapeHtml(r.method_code)}]" value="${r.fee_pct}" style="text-align:right;padding:4px 6px;font-size:0.85rem" required>
                    <span style="font-weight:bold;color:var(--muted);font-size:0.8rem">%</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Seção 3: Pix & Dinheiro (Gerais) -->
          <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;padding:14px;background:#f0fdf4">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="font-size:1.1rem">🟢</span>
              <strong style="color:var(--text);font-size:0.95rem">3. Pix & Dinheiro (À Vista)</strong>
              <span class="badge signed" style="font-size:0.75rem">Sem taxa</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:8px">
              ${generalRates.map((r) => `
                <label class="field" style="margin:0">
                  <span style="font-size:0.78rem;font-weight:600">${escapeHtml(r.label)}</span>
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" step="0.01" min="0" name="rates[${escapeHtml(r.method_code)}]" value="${r.fee_pct}" style="text-align:right;padding:4px 6px;font-size:0.85rem" required>
                    <span style="font-weight:bold;color:var(--muted);font-size:0.8rem">%</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <button class="btn primary" type="submit">💾 Atualizar Todas as Taxas da Ton Black</button>
        </form>
      </section>
    </div>

    <script>
      function formatMoney(val) {
        return (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      ${renderMaterialsPickerScript('main', 'recalcMainProfit')}

      function selectMainDirectPayment(methodCode, feePct, inst, label) {
        document.getElementById('mainPaymentMethod').value = methodCode;
        document.getElementById('mainInstallments').value = inst;
        var feeInput = document.getElementById('mainCardPct');
        if (feeInput) feeInput.value = feePct.toFixed(2);

        var selVM = document.getElementById('mainPayVisaMaster');
        var selElo = document.getElementById('mainPayEloAmex');
        if (selVM) { selVM.value = ''; selVM.classList.remove('has-value'); }
        if (selElo) { selElo.value = ''; selElo.classList.remove('has-value'); }

        var btnPix = document.getElementById('mainBtnPix');
        var btnDin = document.getElementById('mainBtnDinheiro');
        if (btnPix) btnPix.classList.toggle('active', methodCode === 'pix');
        if (btnDin) btnDin.classList.toggle('active', methodCode === 'dinheiro');

        var lbl = document.getElementById('mainSelectedPaymentLabel');
        if (lbl) lbl.textContent = 'Selecionado: ' + label + ' (0%)';

        recalcMainProfit();
      }

      function selectMainBrandOption(selectElem, brand) {
        if (!selectElem.value) return;
        var opt = selectElem.options[selectElem.selectedIndex];
        var fee = parseFloat(opt.dataset.fee) || 0;
        var inst = parseInt(opt.dataset.installments) || 1;
        var label = opt.dataset.label || selectElem.value;

        document.getElementById('mainPaymentMethod').value = selectElem.value;
        document.getElementById('mainInstallments').value = inst;
        var feeInput = document.getElementById('mainCardPct');
        if (feeInput) feeInput.value = fee.toFixed(2);

        if (brand === 'visa_master') {
          var other = document.getElementById('mainPayEloAmex');
          if (other) { other.value = ''; other.classList.remove('has-value'); }
          selectElem.classList.add('has-value');
        } else {
          var other = document.getElementById('mainPayVisaMaster');
          if (other) { other.value = ''; other.classList.remove('has-value'); }
          selectElem.classList.add('has-value');
        }

        var btnPix = document.getElementById('mainBtnPix');
        var btnDin = document.getElementById('mainBtnDinheiro');
        if (btnPix) btnPix.classList.remove('active');
        if (btnDin) btnDin.classList.remove('active');

        var lbl = document.getElementById('mainSelectedPaymentLabel');
        if (lbl) lbl.textContent = 'Selecionado: ' + label + ' (' + fee.toFixed(2).replace('.', ',') + '%)';

        recalcMainProfit();
      }

      function recalcMainProfit() {
        var gross = parseFloat(document.getElementById('mainCalcGross').value) || 0;
        var extraMat = parseFloat(document.getElementById('mainCalcExtraMat').value) || 0;
        var taxPct = parseFloat(document.getElementById('mainTaxPct').value) || 0;
        var cardPct = parseFloat(document.getElementById('mainCardPct').value) || 0;
        var clinicPct = parseFloat(document.getElementById('mainClinicPct').value) || 0;

        var catalogMatCost = 0;
        var selectedCount = 0;
        var selectedMaterials = [];
        document.querySelectorAll('.main-mat-qty').forEach(function(input) {
          var qty = parseFloat(input.value) || 0;
          if (qty > 0) {
            var id = input.dataset.id;
            var cost = parseFloat(input.dataset.cost) || 0;
            var totalItem = qty * cost;
            var cb = document.querySelector('.main-mat-checkbox[data-id="' + id + '"]');
            var name = cb ? cb.dataset.name : ('Item ' + id);
            catalogMatCost += totalItem;
            selectedCount++;
            selectedMaterials.push({ id: id, name: name, cost: cost, qty: qty, total: totalItem });
          }
        });

        var totalMaterials = catalogMatCost + extraMat;

        // 1. Taxa do cartão
        var cardFeeAmount = gross * (cardPct / 100);
        var valueAfterCard = Math.max(0, gross - cardFeeAmount);

        // 2. Imposto de 6% sobre o valor pós-cartão
        var taxAmount = valueAfterCard * (taxPct / 100);
        var valueAfterTax = Math.max(0, valueAfterCard - taxAmount);

        // 3. Repasse da clínica de 30% sobre o valor pós-imposto
        var clinicSplitAmount = valueAfterTax * (clinicPct / 100);
        var professionalSubtotal = Math.max(0, valueAfterTax - clinicSplitAmount);

        // 4. Lucro Líquido final = Cota da Fran - materiais
        var netProfit = professionalSubtotal - totalMaterials;
        var marginPct = gross > 0 ? ((netProfit / gross) * 100).toFixed(1) : '0';

        var matJsonElem = document.getElementById('mainCalcMaterialsJson');
        if (matJsonElem) matJsonElem.value = JSON.stringify(selectedMaterials);
        var taxElem = document.getElementById('mainCalcTaxAmount');
        if (taxElem) taxElem.value = taxAmount.toFixed(2);
        var cardElem = document.getElementById('mainCalcCardFeeAmount');
        if (cardElem) cardElem.value = cardFeeAmount.toFixed(2);
        var clinicElem = document.getElementById('mainCalcClinicSplitAmount');
        if (clinicElem) clinicElem.value = clinicSplitAmount.toFixed(2);
        var netElemHidden = document.getElementById('mainCalcNetProfitHidden');
        if (netElemHidden) netElemHidden.value = netProfit.toFixed(2);

        var lg = document.getElementById('mainLiveGross');
        if (lg) lg.textContent = 'R$ ' + formatMoney(gross);
        var lcp = document.getElementById('mainLiveCardPct');
        if (lcp) lcp.textContent = cardPct.toFixed(2);
        var lcf = document.getElementById('mainLiveCardFee');
        if (lcf) lcf.textContent = '- R$ ' + formatMoney(cardFeeAmount);
        var lac = document.getElementById('mainLiveAfterCard');
        if (lac) lac.textContent = 'R$ ' + formatMoney(valueAfterCard);

        var ltp = document.getElementById('mainLiveTaxPct');
        if (ltp) ltp.textContent = taxPct.toFixed(1);
        var lt = document.getElementById('mainLiveTax');
        if (lt) lt.textContent = '- R$ ' + formatMoney(taxAmount);
        var lat = document.getElementById('mainLiveAfterTax');
        if (lat) lat.textContent = 'R$ ' + formatMoney(valueAfterTax);

        var lclp = document.getElementById('mainLiveClinicPct');
        if (lclp) lclp.textContent = clinicPct.toFixed(1);
        var lcl = document.getElementById('mainLiveClinicSplit');
        if (lcl) lcl.textContent = '- R$ ' + formatMoney(clinicSplitAmount);
        var lps = document.getElementById('mainLiveProfSubtotal');
        if (lps) lps.textContent = 'R$ ' + formatMoney(professionalSubtotal);

        var lm = document.getElementById('mainLiveMaterials');
        if (lm) lm.textContent = '- R$ ' + formatMoney(totalMaterials);
        var lmc = document.getElementById('mainLiveMaterialsCount');
        if (lmc) lmc.textContent = selectedCount + ' item(ns) selecionado(s)' + (extraMat > 0 ? ' + extra' : '');

        var lnp = document.getElementById('mainLiveNetProfit');
        if (lnp) {
          lnp.textContent = 'R$ ' + formatMoney(netProfit);
          if (netProfit < 0) {
            lnp.style.background = '#fef2f2';
            lnp.style.color = '#dc2626';
          } else {
            lnp.style.background = '#f0fdf4';
            lnp.style.color = '#15803d';
          }
        }

        var lmp = document.getElementById('mainLiveMarginPct');
        if (lmp) lmp.textContent = 'Margem Líquida: ' + marginPct + '%';

        var inst = parseInt(document.getElementById('mainInstallments').value) || 1;
        var liveInst = document.getElementById('mainLiveParcelaLabel');
        if (liveInst) {
          if (inst > 1 && gross > 0) {
            var part = gross / inst;
            liveInst.textContent = inst + 'x de R$ ' + formatMoney(part);
          } else {
            var mCode = document.getElementById('mainPaymentMethod').value;
            liveInst.textContent = mCode === 'dinheiro' ? 'Dinheiro à Vista' : (mCode === 'pix' ? 'Pix à Vista' : 'À vista (1x)');
          }
        }
      }

      window.addEventListener('DOMContentLoaded', function() {
        selectMainDirectPayment('pix', 0, 1, 'Pix à Vista');
      });
    </script>
  `;

  res.send(layout({ title: 'Financeiro & Rentabilidade', body, userEmail: req.session.adminEmail, activeNav: 'financeiro' }));
});

app.post('/admin/financeiro/entry', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const patientId = Number(req.body.patientId || 0) || null;
  const description = String(req.body.description || '').trim() || 'Lançamento Financeiro';
  const grossValue = parseFloat(req.body.gross_value) || 0;
  const extraMaterials = parseFloat(req.body.extra_materials) || 0;
  const paymentMethod = String(req.body.payment_method || 'pix').trim();
  const installments = Math.max(1, parseInt(req.body.installments) || 1);
  const taxPct = parseFloat(req.body.tax_pct) || 0;
  const cardFeePct = parseFloat(req.body.card_fee_pct) || 0;
  const clinicSplitPct = parseFloat(req.body.clinic_split_pct) || 0;

  const materialsJson = String(req.body.materials_json || '[]');
  let catalogMatCost = 0;
  try {
    const list = JSON.parse(materialsJson);
    catalogMatCost = list.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  } catch (_e) {}

  const materialsCost = catalogMatCost + extraMaterials;
  const calc = calculateProcedureProfit({
    grossValue,
    cardFeePct,
    taxPct,
    clinicSplitPct,
    materialsCost
  });

  db.prepare(`
    INSERT INTO procedure_financials (
      patient_id, description, payment_method, installments,
      gross_value, materials_cost, materials_json,
      card_fee_pct, card_fee_amount, value_after_card,
      tax_pct, tax_amount, value_after_tax,
      clinic_split_pct, clinic_split_amount, professional_subtotal,
      net_profit, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId, description, paymentMethod, installments,
    calc.grossValue, calc.materialsCost, materialsJson,
    calc.cardFeePct, calc.cardFeeAmount, calc.valueAfterCard,
    calc.taxPct, calc.taxAmount, calc.valueAfterTax,
    calc.clinicSplitPct, calc.clinicSplitAmount, calc.professionalSubtotal,
    calc.netProfit, nowIso()
  );

  res.redirect('/admin/financeiro?saved=1');
});

app.post('/admin/financeiro/card-rates', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const rates = req.body.rates;
  if (rates && typeof rates === 'object') {
    const updateStmt = db.prepare('UPDATE card_fee_rates SET fee_pct = ?, updated_at = ? WHERE method_code = ?');
    const updateTx = db.transaction(() => {
      for (const [code, feeVal] of Object.entries(rates)) {
        const fee = Math.max(0, parseFloat(feeVal) || 0);
        updateStmt.run(fee, nowIso(), code);
      }
    });
    updateTx();
  }
  res.redirect('/admin/financeiro?rates_saved=1#taxas-cartao');
});

app.post('/admin/financial/:id/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const id = Number(req.params.id);
  db.prepare('DELETE FROM procedure_financials WHERE id = ?').run(id);
  const returnUrl = req.body.returnUrl || '/admin/financeiro?deleted=1';
  res.redirect(returnUrl);
});

app.post('/admin/financeiro/settings', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const taxPct = parseFloat(req.body.default_tax_pct) || 0;
  const cardPct = parseFloat(req.body.default_card_fee_pct) || 0;
  const clinicPct = parseFloat(req.body.default_clinic_split_pct) || 0;

  db.prepare(`
    UPDATE clinic_settings
    SET default_tax_pct = ?, default_card_fee_pct = ?, default_clinic_split_pct = ?, updated_at = ?
    WHERE id = 1
  `).run(taxPct, cardPct, clinicPct, nowIso());

  res.redirect('/admin/financeiro?settings_saved=1');
});

// ─── GESTÃO DO CATÁLOGO DE INSUMOS & MATERIAIS ─────────────────────────────
app.get('/admin/materiais', requireAuth, (req, res) => {
  const materials = db.prepare('SELECT * FROM material_costs ORDER BY category ASC, name ASC').all();

  const rows = materials.length
    ? materials
        .map(
          (m) => `
            <tr>
              <td><span class="badge" style="background:#f4efe7;color:var(--accent);font-weight:600">${escapeHtml(m.category || 'Geral')}</span></td>
              <td><strong>${escapeHtml(m.name)}</strong></td>
              <td>${escapeHtml(m.unit_type)}</td>
              <td><strong>R$ ${escapeHtml(formatBRL(m.cost_per_unit))}</strong></td>
              <td>
                ${m.is_active ? '<span class="badge signed">Ativo</span>' : '<span class="badge" style="background:#eee;color:#777">Inativo</span>'}
              </td>
              <td style="display:flex;gap:6px">
                <form method="post" action="/admin/materiais/${m.id}/edit" style="display:inline-flex;gap:4px">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <input type="number" step="0.01" name="cost_per_unit" value="${m.cost_per_unit}" style="width:75px;padding:3px 6px;border-radius:6px;border:1px solid var(--line);font-size:0.82rem">
                  <button class="btn tiny" type="submit">Salvar Preço</button>
                </form>
                <form method="post" action="/admin/materiais/${m.id}/toggle" style="display:inline">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <button class="btn tiny ghost" type="submit">${m.is_active ? 'Desativar' : 'Ativar'}</button>
                </form>
                <form method="post" action="/admin/materiais/${m.id}/delete" onsubmit="return confirm('Excluir este insumo?')" style="display:inline">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                  <button class="btn tiny danger" type="submit">✕</button>
                </form>
              </td>
            </tr>
          `
        )
        .join('')
    : '<tr><td colspan="6" class="muted">Nenhum insumo cadastrado ainda.</td></tr>';

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Precificação & Insumos</p>
        <h1>Catálogo de Materiais e Custos</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin/simulador">🧮 Simulador</a>
        <a class="btn" href="/admin/financeiro">💰 Voltar ao Financeiro</a>
        <a class="btn primary" href="/admin/agenda">📅 Agenda</a>
      </div>
    </header>

    ${renderAlert(req.query.saved ? 'Insumo cadastrado com sucesso!' : null, 'success')}
    ${renderAlert(req.query.updated ? 'Insumo atualizado com sucesso!' : null, 'success')}
    ${renderAlert(req.query.deleted ? 'Insumo excluído.' : null, 'info')}

    <!-- Tabela de Materiais -->
    <section class="panel">
      <h2>Materiais e Insumos Cadastrados (Oficiais)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Nome do Material / Produto</th>
              <th>Apresentação / Unidade</th>
              <th>Custo Unitário (R$)</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Formulário para Novo Material -->
    <section class="panel" style="max-width:620px">
      <h2>+ Adicionar Novo Insumo ao Catálogo</h2>
      <form class="form-stack" method="post" action="/admin/materiais" style="margin-top:14px">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px">
          <label class="field">
            <span>Nome do Insumo / Produto *</span>
            <input type="text" name="name" placeholder="Ex.: Toxina Botulínica 100U (Frasco)" required>
          </label>
          <label class="field">
            <span>Categoria *</span>
            <select name="category" required>
              <option value="Tecnologia">Tecnologia</option>
              <option value="Toxina Botulínica">Toxina Botulínica</option>
              <option value="Preenchedor">Preenchedor</option>
              <option value="Bioestimulador">Bioestimulador</option>
              <option value="Fios PDO">Fios PDO</option>
              <option value="Cânulas e Insumos">Cânulas e Insumos</option>
              <option value="Procedimento / Sessão">Procedimento / Sessão</option>
              <option value="Geral" selected>Geral</option>
            </select>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <label class="field">
            <span>Tipo de Unidade *</span>
            <input type="text" name="unit_type" placeholder="Ex.: Frasco, mL, Fio, Disparo" required>
          </label>
          <label class="field">
            <span>Custo Unitário (R$) *</span>
            <input type="number" step="0.01" min="0" name="cost_per_unit" placeholder="420,00" required>
          </label>
          <label class="field">
            <span>Passo Rápido (+/-)</span>
            <input type="number" step="1" min="1" name="quick_step" value="1" placeholder="1">
          </label>
        </div>
        <button class="btn primary" type="submit">Cadastrar Insumo</button>
      </form>
    </section>
  `;

  res.send(layout({ title: 'Catálogo de Insumos', body, userEmail: req.session.adminEmail, activeNav: 'materiais' }));
});

app.post('/admin/materiais', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || 'Geral').trim();
  const unitType = String(req.body.unit_type || 'Unidade').trim();
  const cost = parseFloat(req.body.cost_per_unit) || 0;
  const quickStep = parseFloat(req.body.quick_step) || 1;

  if (!name || cost < 0) {
    res.redirect('/admin/materiais?error=invalid');
    return;
  }

  db.prepare(`
    INSERT INTO material_costs (name, category, unit_type, cost_per_unit, quick_step, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(name, category, unitType, cost, quickStep, nowIso());

  res.redirect('/admin/materiais?saved=1');
});

app.post('/admin/materiais/:id/edit', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const id = Number(req.params.id);
  const cost = parseFloat(req.body.cost_per_unit) || 0;

  db.prepare('UPDATE material_costs SET cost_per_unit = ? WHERE id = ?').run(cost, id);
  res.redirect('/admin/materiais?updated=1');
});

app.post('/admin/materiais/:id/toggle', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const id = Number(req.params.id);
  const item = db.prepare('SELECT is_active FROM material_costs WHERE id = ?').get(id);
  if (item) {
    db.prepare('UPDATE material_costs SET is_active = ? WHERE id = ?').run(item.is_active ? 0 : 1, id);
  }
  res.redirect('/admin/materiais?updated=1');
});

app.post('/admin/materiais/:id/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const id = Number(req.params.id);
  db.prepare('DELETE FROM material_costs WHERE id = ?').run(id);
  res.redirect('/admin/materiais?deleted=1');
});

// ─── Configurações ─────────────────────────────────────────────────────────
app.get('/admin/settings', requireAuth, (req, res) => {
  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Área da profissional</p>
        <h1>Configurações</h1>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
      </div>
    </header>

    ${renderAlert(req.query.ok === 'password' ? 'Senha atualizada com sucesso.' : null, 'success')}
    ${renderAlert(req.query.error || null, 'error')}

    <section class="panel">
      <h2>Alterar senha</h2>
      <form class="form-stack" method="post" action="/admin/settings/password" style="max-width:440px">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <label class="field">
          <span>Senha atual</span>
          <input type="password" name="currentPassword" required>
        </label>
        <label class="field">
          <span>Nova senha</span>
          <input type="password" name="newPassword" required minlength="8">
        </label>
        <label class="field">
          <span>Confirmar nova senha</span>
          <input type="password" name="confirmPassword" required minlength="8">
        </label>
        <button class="btn primary" type="submit">Salvar nova senha</button>
      </form>
    </section>

    <section class="panel">
      <h2>Backup do banco de dados</h2>
      <p class="muted">Baixe o arquivo do banco SQLite com todos os dados da plataforma (pacientes, questionários, agenda e chat).</p>
      <a class="btn primary" href="/admin/backup">Baixar backup (clinic.db)</a>
    </section>
  `;

  res.send(layout({ title: 'Configurações', body, userEmail: req.session.adminEmail }));
});

app.post('/admin/settings/password', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (newPassword.length < 8) {
    res.redirect('/admin/settings?error=' + encodeURIComponent('A nova senha precisa ter no mínimo 8 caracteres.'));
    return;
  }

  if (newPassword !== confirmPassword) {
    res.redirect('/admin/settings?error=' + encodeURIComponent('As senhas não conferem.'));
    return;
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
    res.redirect('/admin/settings?error=' + encodeURIComponent('Senha atual incorreta.'));
    return;
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, admin.id);

  res.redirect('/admin/settings?ok=password');
});

// ─── Memória da IA ─────────────────────────────────────────────────────────
app.get('/admin/ia-memoria', requireAuth, (req, res) => {
  const entries = db.prepare('SELECT * FROM ai_knowledge ORDER BY ordem ASC, id ASC').all();

  const rows = entries.map((e) => `
    <tr>
      <td>${escapeHtml(e.titulo)}</td>
      <td style="max-width:380px;white-space:pre-wrap;word-break:break-word;font-size:0.85rem">${escapeHtml(e.conteudo.slice(0, 200))}${e.conteudo.length > 200 ? '…' : ''}</td>
      <td>
        <form method="post" action="/admin/ia-memoria/${e.id}/toggle" style="display:inline">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <button class="btn tiny${e.ativo ? ' primary' : ''}" type="submit" title="${e.ativo ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}">
            ${e.ativo ? 'Ativo' : 'Inativo'}
          </button>
        </form>
      </td>
      <td>
        <form method="post" action="/admin/ia-memoria/${e.id}/delete" style="display:inline" onsubmit="return confirm('Remover este bloco de conhecimento?')">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <button class="btn tiny danger" type="submit">Remover</button>
        </form>
      </td>
    </tr>`).join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Área da profissional</p>
        <h1>Memória da IA</h1>
        <p class="muted" style="margin-top:4px">Blocos de conhecimento enviados para a IA em todas as conversas (protocolos, produtos, preferências, instruções).</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
      </div>
    </header>

    ${renderAlert(req.query.ok === 'saved' ? 'Bloco salvo com sucesso.' : req.query.ok === 'deleted' ? 'Bloco removido.' : req.query.ok === 'toggled' ? 'Status atualizado.' : null, 'success')}
    ${renderAlert(req.query.error || null, 'error')}

    <section class="panel">
      <h2>Adicionar novo bloco de conhecimento</h2>
      <form class="form-stack" method="post" action="/admin/ia-memoria" style="max-width:640px">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <label class="field">
          <span>Título <small class="muted">(ex.: Protocolo anti-acne, Produtos favoritos, Regras de atendimento)</small></span>
          <input type="text" name="titulo" required maxlength="120" placeholder="Ex.: Protocolo pele oleosa">
        </label>
        <label class="field">
          <span>Conteúdo <small class="muted">(escreva livremente — a IA vai usar isso como referência em todas as respostas)</small></span>
          <textarea name="conteudo" required rows="6" placeholder="Ex.: Para peles oleosas com acne, priorizar ativos como ácido salicílico, niacinamida e azaleico. Evitar óleos comedogênicos. Sempre perguntar sobre uso de isotretinoína..."></textarea>
        </label>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px">
          <input type="number" name="ordem" value="0" min="0" max="999" style="width:70px">
          <span>Ordem de prioridade <small class="muted">(menor número = mostrado primeiro para a IA)</small></span>
        </label>
        <button class="btn primary" type="submit">Salvar bloco</button>
      </form>
    </section>

    <section class="panel">
      <h2>Blocos salvos (${entries.length})</h2>
      ${entries.length === 0
        ? '<p class="muted">Nenhum bloco cadastrado ainda. Adicione acima.</p>'
        : `<div style="overflow-x:auto">
            <table class="table" style="width:100%">
              <thead><tr><th>Título</th><th>Conteúdo (prévia)</th><th>Status</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`}
    </section>
  `;

  res.send(layout({ title: 'Memória da IA', body, userEmail: req.session.adminEmail }));
});

app.post('/admin/ia-memoria', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const titulo = String(req.body.titulo || '').trim();
  const conteudo = String(req.body.conteudo || '').trim();
  const ordem = parseInt(req.body.ordem) || 0;
  if (!titulo || !conteudo) {
    res.redirect('/admin/ia-memoria?error=' + encodeURIComponent('Título e conteúdo são obrigatórios.'));
    return;
  }
  db.prepare(
    'INSERT INTO ai_knowledge (titulo, conteudo, ativo, ordem, created_at) VALUES (?, ?, 1, ?, ?)'
  ).run(titulo, conteudo, ordem, new Date().toISOString());
  res.redirect('/admin/ia-memoria?ok=saved');
});

app.post('/admin/ia-memoria/:id/toggle', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  const entry = db.prepare('SELECT id, ativo FROM ai_knowledge WHERE id = ?').get(req.params.id);
  if (!entry) { res.status(404).send('Não encontrado.'); return; }
  db.prepare('UPDATE ai_knowledge SET ativo = ? WHERE id = ?').run(entry.ativo ? 0 : 1, entry.id);
  res.redirect('/admin/ia-memoria?ok=toggled');
});

app.post('/admin/ia-memoria/:id/delete', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) { res.status(403).send('CSRF inválido.'); return; }
  db.prepare('DELETE FROM ai_knowledge WHERE id = ?').run(req.params.id);
  res.redirect('/admin/ia-memoria?ok=deleted');
});

// ─── Backup: download do banco SQLite ─────────────────────────────────────
app.get('/admin/backup', requireAuth, (req, res) => {
  if (!fs.existsSync(dbPath)) {
    res.status(404).send('Banco de dados não encontrado.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `clinic-backup-${timestamp}.db`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  // Usa o VACUUM INTO para gerar um backup limpo sem locks
  const backupPath = path.join(storageDir, `backup-tmp-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    res.sendFile(backupPath, {}, () => {
      try { fs.unlinkSync(backupPath); } catch (_e) { /* ignora */ }
    });
  } catch (_err) {
    try { fs.unlinkSync(backupPath); } catch (_e) { /* ignora */ }
    // Fallback: envia o arquivo direto
    res.download(dbPath, filename);
  }
});

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith('/admin')) {
    res.status(500).send('Erro interno na área administrativa.');
    return;
  }

  res.status(500).send(
    layout({
      title: 'Erro',
      body: `<section class="panel"><h1>Erro interno</h1><p>${escapeHtml(err.message || 'Falha inesperada.')}</p></section>`
    })
  );
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor ativo em ${BASE_URL}`);
  });
}

module.exports = { app, calculateProcedureProfit };
