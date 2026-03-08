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
      secure: IS_PRODUCTION,
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
      const safeExt = ext.match(/^\.[a-z0-9]+$/i) ? ext : '.bin';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 25
  },
  fileFilter: (_req, file, cb) => {
    const isImage = file.mimetype && file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (isImage || isPdf) {
      cb(null, true);
      return;
    }
    cb(new Error('Apenas imagens e PDFs são permitidos nos uploads.'));
  }
});

const uploadPatientFiles = upload.fields([
  { name: 'facePhotos', maxCount: 8 },
  { name: 'productPhotos', maxCount: 12 },
  { name: 'examFiles', maxCount: 5 }
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
  const phone = String(payload.telefone || '').trim() || null;

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
    const options = (field.options || [])
      .map(
        (option) => `
          <label class="option-line">
            <input type="checkbox" name="${name}" value="${escapeHtml(option)}">
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

function layout({ title, body, userEmail = null }) {
  const authBlock = userEmail
    ? `<div class="user-chip">Área privada: ${escapeHtml(userEmail)}</div>`
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
        <link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
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
          <input type="password" name="password" required>
        </label>
        <button class="btn primary" type="submit">Entrar</button>
      </form>
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

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
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

app.get('/admin', requireAuth, (req, res) => {
  const counters = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM patients) AS total_patients,
        (SELECT COUNT(*) FROM submissions) AS total_submissions,
        (SELECT COUNT(*) FROM patient_links WHERE is_used = 0) AS pending_links,
        (SELECT COUNT(*) FROM appointments WHERE start_at >= ? AND status != 'cancelled') AS upcoming_appointments,
        (SELECT COALESCE(SUM(value), 0) FROM appointments WHERE start_at >= ? AND status != 'cancelled') AS upcoming_revenue
      `
    )
    .get(nowIso(), nowIso());

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

  const linkRows = rows
    .map((row) => {
      const patientLink = `${BASE_URL}/paciente/${row.token}`;
      const status = row.is_used ? '<span class="chip done">Respondido</span>' : '<span class="chip pending">Aguardando</span>';
      const patientName = row.patient_name || '-';
      const patientEmail = row.patient_email || '-';
      const code = row.patient_code ? toCodeNumber(row.patient_code) : '----';
      const patientCell = row.resolved_patient_id
        ? `<a class="patient-link" href="/admin/patients/${row.resolved_patient_id}"><span class="patient-code">${escapeHtml(code)}</span> ${escapeHtml(patientName)}</a>`
        : `<span><span class="patient-code muted">${escapeHtml(code)}</span> ${escapeHtml(patientName)}</span>`;
      const actions = row.submission_id
        ? `<a class="btn tiny" href="/admin/submissions/${row.submission_id}">Abrir prontuário</a>`
        : '<span class="muted">Sem resposta</span>';

      return `
        <tr>
          <td>${status}</td>
          <td>${patientCell}</td>
          <td>${escapeHtml(patientEmail)}</td>
          <td>
            <div class="link-inline">
              <code>${escapeHtml(patientLink)}</code>
            </div>
          </td>
          <td>${actions}</td>
        </tr>
      `;
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
        </article>
      </div>
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

    <section class="panel">
      <h2>Lista de links e respostas</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Paciente</th>
              <th>E-mail</th>
              <th>Link</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${linkRows || '<tr><td colspan="5" class="muted">Nenhum link criado ainda.</td></tr>'}
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
    <section class="hero-card compact">
      <p class="eyebrow">Questionário Clínico</p>
      <h1>Consultoria personalizada de skincare</h1>
      <p class="hero-copy">Preencha com calma. As informações serão vistas apenas pela profissional.</p>
    </section>

    <form class="panel form-stack" method="post" action="/paciente/${escapeHtml(token)}" enctype="multipart/form-data">
      <input type="hidden" name="_csrf" value="${escapeHtml(patientCsrfToken(token))}">
      ${sectionsHtml}

      <section class="section-block" id="fotos">
        <h2>19) Envio de Fotos</h2>
        <p class="muted">
          Envie fotos do rosto (frontal, perfis e close da queixa) e fotos dos produtos que você usa.
          Prefira luz natural, sem maquiagem e sem filtro.
        </p>

        <label class="field">
          <span>Fotos do rosto</span>
          <input type="file" name="facePhotos" accept="image/*" multiple>
        </label>

        <label class="field">
          <span>Fotos dos produtos da rotina</span>
          <input type="file" name="productPhotos" accept="image/*" multiple>
        </label>
      </section>

      <button class="btn primary block" type="submit">Enviar questionário</button>
    </form>
  `;

  res.send(layout({ title: 'Questionário', body }));
});

app.post('/paciente/:token', (req, res) => {
  uploadPatientFiles(req, res, (uploadError) => {
    if (uploadError) {
      res.status(400).send(
        layout({
          title: 'Erro no envio',
          body: `<section class="panel"><h1>Erro no envio</h1><p>${escapeHtml(uploadError.message)}</p></section>`
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

    const insertSubmission = db.prepare(
      'INSERT INTO submissions (patient_id, link_id, token, data_json, created_at) VALUES (?, ?, ?, ?, ?)'
    );

    const tx = db.transaction(() => {
      const patientId = getOrCreatePatientFromPayload(payload, link.patient_id || null);
      const result = insertSubmission.run(patientId, link.id, token, JSON.stringify(payload), nowIso());
      const submissionId = result.lastInsertRowid;
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
        <tr>
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
      <div class="table-wrap">
        <table>
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
          </tbody>
        </table>
      </div>
    </section>
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

  const submissions = db
    .prepare(
      `
      SELECT
        s.id,
        s.created_at,
        json_extract(s.data_json, '$.queixaPrincipal') AS queixa_principal,
        json_extract(s.data_json, '$.expectativaConsultoria') AS expectativa
      FROM submissions s
      WHERE s.patient_id = ?
      ORDER BY s.created_at DESC
      `
    )
    .all(patientId);

  const appointments = db
    .prepare(
      `
      SELECT id, title, start_at, end_at, notes, status
      FROM appointments
      WHERE patient_id = ?
      ORDER BY start_at DESC
      LIMIT 200
      `
    )
    .all(patientId);

  const submissionsRows = submissions
    .map(
      (submission) => `
        <tr>
          <td>#${submission.id}</td>
          <td>${escapeHtml(formatDateTime(submission.created_at))}</td>
          <td>${safeFieldValue(submission.queixa_principal)}</td>
          <td>${safeFieldValue(submission.expectativa)}</td>
          <td><a class="btn tiny" href="/admin/submissions/${submission.id}">Abrir</a></td>
        </tr>
      `
    )
    .join('');

  const statusLabel = { scheduled: 'Agendada', confirmed: 'Confirmada', cancelled: 'Cancelada' };
  const appointmentsRows = appointments
    .map(
      (appointment) => `
        <tr>
          <td>${escapeHtml(formatDateTime(appointment.start_at))}</td>
          <td>${escapeHtml(formatDateTime(appointment.end_at))}</td>
          <td>${escapeHtml(appointment.title)}</td>
          <td>${escapeHtml(statusLabel[appointment.status] || appointment.status)}</td>
          <td>${escapeHtml(appointment.notes || '-')}</td>
          <td>
            ${appointment.status !== 'cancelled' ? `
            <form method="post" action="/admin/agenda/${appointment.id}/status" style="display:inline">
              <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
              <input type="hidden" name="returnPatient" value="${patient.id}">
              ${appointment.status !== 'confirmed' ? `<button class="btn tiny" name="status" value="confirmed">Confirmar</button>` : ''}
              <button class="btn tiny danger" name="status" value="cancelled">Cancelar</button>
            </form>` : '<span class="muted">—</span>'}
          </td>
        </tr>
      `
    )
    .join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Prontuário da paciente</p>
        <h1><span class="patient-code">${escapeHtml(toCodeNumber(patient.patient_code))}</span> ${escapeHtml(patient.full_name)}</h1>
        <p class="muted">${escapeHtml(patient.email || '-')} · ${escapeHtml(patient.phone || '-')}</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin/patients">Todas as pacientes</a>
        <a class="btn" href="/admin/agenda">Agenda</a>
        <a class="btn primary" href="/admin/chat?patientId=${patient.id}">Conversar com IA sobre esta paciente</a>
      </div>
    </header>

    <section class="panel">
      <h2>Histórico de questionários</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Questionário</th>
              <th>Data</th>
              <th>Queixa principal</th>
              <th>Expectativa</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${submissionsRows || '<tr><td colspan="5" class="muted">Ainda não há questionários para esta paciente.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>Consultas na agenda</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Início</th>
              <th>Fim</th>
              <th>Título</th>
              <th>Status</th>
              <th>Observações</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${appointmentsRows || '<tr><td colspan="6" class="muted">Nenhuma consulta marcada.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;

  res.send(layout({ title: `Prontuário ${patient.full_name}`, body, userEmail: req.session.adminEmail }));
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
        p.patient_code
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

  const calendarCells = buildMonthGrid(monthDate)
    .map((cell) => {
      if (!cell) {
        return '<article class="calendar-cell empty"></article>';
      }

      const events = eventsByDay.get(cell.dateKey) || [];
      const eventsHtml = events
        .map(
          (event) => {
            const statusBadge = event.status === 'confirmed'
              ? '<span class="chip done" style="font-size:0.68rem;padding:1px 6px;">Confirmada</span>'
              : event.status === 'cancelled'
              ? '<span class="chip" style="font-size:0.68rem;padding:1px 6px;background:var(--danger);color:#fff;">Cancelada</span>'
              : '<span class="chip pending" style="font-size:0.68rem;padding:1px 6px;">Agendada</span>';
            return `
            <div class="calendar-event-block">
              ${event.patient_id
                ? `<a class="calendar-event" href="/admin/patients/${event.patient_id}">
                    <span>${escapeHtml(formatTime(event.start_at))}</span>
                    <strong>${escapeHtml(toCodeNumber(event.patient_code))}</strong>
                    <span>${escapeHtml(event.full_name)}</span>
                    ${statusBadge}
                    ${event.value != null ? `<span class="appointment-value">R$ ${escapeHtml(formatBRL(event.value))}</span>` : ''}
                  </a>`
                : `<div class="calendar-event">
                    <span>${escapeHtml(formatTime(event.start_at))}</span>
                    <strong>${escapeHtml(event.title)}</strong>
                    ${statusBadge}
                    ${event.value != null ? `<span class="appointment-value">R$ ${escapeHtml(formatBRL(event.value))}</span>` : ''}
                  </div>`
              }
              ${event.status !== 'cancelled' ? `
              <form method="post" action="/admin/agenda/${event.id}/status" style="display:inline">
                <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
                <input type="hidden" name="returnMonth" value="${escapeHtml(monthKey)}">
                ${event.status !== 'confirmed' ? `<button class="btn tiny" name="status" value="confirmed" title="Confirmar">✓</button>` : ''}
                <button class="btn tiny danger" name="status" value="cancelled" title="Cancelar">✗</button>
              </form>` : ''}
            </div>
          `;
          }
        )
        .join('');

      const hasEvents = events.length > 0;
      return `
        <article class="calendar-cell${hasEvents ? ' has-events' : ''}">
          <header>${cell.day}</header>
          <div class="calendar-events">
            ${eventsHtml || '<span class="muted">Sem consulta</span>'}
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

    ${renderAlert(req.query.created ? 'Consulta agendada com sucesso.' : null, 'success')}
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

    <section class="panel">
      <h2>Marcar nova consulta</h2>
      <form class="form-stack" method="post" action="/admin/agenda">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <input type="hidden" name="returnMonth" value="${escapeHtml(monthKey)}">
        <label class="field">
          <span>Paciente <span class="muted" style="font-size:0.82rem">(opcional)</span></span>
          <select name="patientId">
            <option value="">— Sem paciente vinculado —</option>
            ${patientOptions}
          </select>
        </label>
        <label class="field">
          <span>Título</span>
          <input type="text" name="title" placeholder="Consulta de retorno" required>
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
          <textarea name="notes" rows="3" placeholder="Ex.: revisar rotina e reação ao retinol"></textarea>
        </label>
        <button class="btn primary" type="submit">Salvar consulta</button>
      </form>
    </section>
  `;

  res.send(layout({ title: 'Agenda', body, userEmail: req.session.adminEmail }));
});

app.post('/admin/agenda', requireAuth, (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).send('CSRF inválido.');
    return;
  }

  const resolvedPatientId = Number(req.body.patientId || 0) || null;
  const title = String(req.body.title || '').trim();
  const startAt = combineDateTime(req.body.startDate, req.body.startTime);
  const endAt = combineDateTime(req.body.endDate, req.body.endTime) || null;
  const notes = String(req.body.notes || '').trim() || null;
  const value = parseFloat(String(req.body.value || '').replace(',', '.')) || null;
  const returnMonth = String(req.body.returnMonth || '').trim();
  const redirectMonth = /^\d{4}-\d{2}$/.test(returnMonth) ? returnMonth : monthKeyFromDate(new Date());

  if (!title || !startAt) {
    res.redirect(`/admin/agenda?month=${encodeURIComponent(redirectMonth)}&error=${encodeURIComponent('Preencha título e horário de início.')}`);
    return;
  }

  if (resolvedPatientId) {
    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(resolvedPatientId);
    if (!patient) {
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

  const targetMonth = String(startAt).slice(0, 7);
  const monthToOpen = /^\d{4}-\d{2}$/.test(targetMonth) ? targetMonth : redirectMonth;
  res.redirect(`/admin/agenda?month=${encodeURIComponent(monthToOpen)}&created=1`);
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
          <input type="file" name="facePhotos" accept="image/*" multiple>
        </label>
        <label class="field">
          <span>Novas fotos de produtos</span>
          <input type="file" name="productPhotos" accept="image/*" multiple>
        </label>
        <button class="btn primary" type="submit">Adicionar fotos</button>
      </form>
    </section>

    ${sectionsHtml}
    ${renderFileList('Arquivos de Exames', examFiles)}
    ${renderImageList('Fotos do rosto', faceFiles)}
    ${renderImageList('Fotos de produtos', productFiles)}
  `;

  res.send(layout({ title: `Resposta ${submissionId}`, body, userEmail: req.session.adminEmail }));
});

app.post('/admin/submissions/:id/files', requireAuth, (req, res) => {
  uploadPatientFiles(req, res, (uploadError) => {
    const submissionId = Number(req.params.id);

    if (uploadError) {
      res.redirect(`/admin/submissions/${submissionId}?uploadError=${encodeURIComponent(uploadError.message)}`);
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

  if (file.mime_type) {
    res.setHeader('Content-Type', file.mime_type);
  }

  res.sendFile(absPath);
});

app.get('/admin/chat', requireAuth, (req, res) => {
  const selectedSubmissionId = Number(req.query.submissionId || 0) || null;
  const selectedPatientId = Number(req.query.patientId || 0) || null;

  const submissions = db
    .prepare(
      `
      SELECT
        s.id,
        s.patient_id,
        s.created_at,
        p.patient_code,
        p.full_name AS patient_name,
        json_extract(s.data_json, '$.nomeCompleto') AS nome,
        json_extract(s.data_json, '$.queixaPrincipal') AS queixa
      FROM submissions s
      LEFT JOIN patients p ON p.id = s.patient_id
      ORDER BY s.id DESC
      LIMIT 200
      `
    )
    .all();

  const patients = db
    .prepare('SELECT id, patient_code, full_name FROM patients ORDER BY id ASC')
    .all();

  const messages = db
    .prepare(
      `
      SELECT
        m.*,
        p.patient_code,
        p.full_name AS patient_name
      FROM chat_messages m
      LEFT JOIN patients p ON p.id = m.patient_id
      ORDER BY m.id ASC
      LIMIT 200
      `
    )
    .all();

  const messagesHtml = messages
    .map((msg) => {
      const cssRole = msg.role === 'assistant' ? 'assistant' : 'user';
      const submissionTag = msg.submission_id
        ? `<span class="msg-tag">Caso #${msg.submission_id}</span>`
        : '';
      const patientTag = msg.patient_id
        ? `<span class="msg-tag patient">Paciente ${escapeHtml(toCodeNumber(msg.patient_code || msg.patient_id))} - ${escapeHtml(msg.patient_name || '')}</span>`
        : '';
      return `
        <article class="chat-message ${cssRole}">
          <header>
            <strong>${msg.role === 'assistant' ? 'LLM' : 'Você'}</strong>
            ${submissionTag}
            ${patientTag}
            <span>${escapeHtml(new Date(msg.created_at).toLocaleString('pt-BR'))}</span>
          </header>
          <p>${escapeHtml(msg.content)}</p>
        </article>
      `;
    })
    .join('');

  const options = submissions
    .map((item) => {
      const labelName = item.patient_name || item.nome || `Caso ${item.id}`;
      const codeText = item.patient_code ? toCodeNumber(item.patient_code) : '----';
      const selected = selectedSubmissionId === item.id ? 'selected' : '';
      return `<option value="${item.id}" ${selected}>#${item.id} - ${escapeHtml(codeText)} ${escapeHtml(labelName)}</option>`;
    })
    .join('');

  const patientOptions = patients
    .map((item) => {
      const selected = selectedPatientId === item.id ? 'selected' : '';
      return `<option value="${item.id}" ${selected}>${escapeHtml(toCodeNumber(item.patient_code))} - ${escapeHtml(item.full_name)}</option>`;
    })
    .join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Assistente com LLM via API</p>
        <h1>Chat clínico</h1>
        <p class="muted">A LLM recebe contexto global da plataforma (pacientes, respostas e agenda) para raciocinar com base completa.</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
      </div>
    </header>

    ${renderAlert(req.query.error, 'error')}

    <section class="panel chat-wrap">
      <div class="chat-feed">
        ${messagesHtml || '<p class="muted">Ainda não há mensagens.</p>'}
      </div>

      <form class="form-stack" method="post" action="/admin/chat">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
        <label class="field">
          <span>Associar a uma paciente (opcional)</span>
          <select name="patientId">
            <option value="">Sem paciente específica</option>
            ${patientOptions}
          </select>
        </label>
        <label class="field">
          <span>Associar a um caso (opcional)</span>
          <select name="submissionId">
            <option value="">Sem caso específico</option>
            ${options}
          </select>
        </label>
        <label class="field">
          <span>Mensagem</span>
          <textarea name="message" rows="5" required placeholder="Ex.: Analise o caso e sugira uma rotina inicial para pele sensível com manchas."></textarea>
        </label>
        <button class="btn primary" type="submit">Enviar para LLM</button>
      </form>
    </section>
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

async function callLlm(currentMessage, submissionId, patientId) {
  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4.1-mini';

  if (!apiKey) {
    throw new Error('Defina LLM_API_KEY no arquivo .env');
  }

  const recentMessages = db
    .prepare('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 16')
    .all()
    .reverse();

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

  if (submissionId) {
    const submission = db
      .prepare(
        `
        SELECT s.id, s.data_json,
          (SELECT COUNT(*) FROM submission_files f WHERE f.submission_id = s.id AND f.category = 'face') AS qtd_face,
          (SELECT COUNT(*) FROM submission_files f WHERE f.submission_id = s.id AND f.category = 'product') AS qtd_produtos
        FROM submissions s
        WHERE s.id = ?
        `
      )
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
      contextBlocks.push(`Fotos do rosto enviadas: ${submission.qtd_face}`);
      contextBlocks.push(`Fotos de produtos enviadas: ${submission.qtd_produtos}`);
      contextBlocks.push('Resumo das respostas:');
      contextBlocks.push(summaryLines.join('\n'));
    }
  }

  const systemPrompt = [
    'Você é uma assistente de suporte para consultoria de skincare.',
    'Responda em português do Brasil.',
    'Você deve usar toda a base de dados enviada para raciocinar, cruzar padrões e justificar respostas com dados.',
    'Seja objetiva, segura e ética; nunca substitua diagnóstico médico.',
    'Quando houver risco clínico (alergia, reação intensa, suspeita de doença), oriente procurar dermatologista.'
  ].join(' ');

  const messages = [{ role: 'system', content: systemPrompt }];

  if (contextBlocks.length > 0) {
    messages.push({ role: 'system', content: contextBlocks.join('\n') });
  }

  for (const msg of recentMessages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      continue;
    }
    messages.push({ role: msg.role, content: msg.content });
  }

  if (!recentMessages.length) {
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
      temperature: 0.4
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
    .map((section) => {
      const rows = section.fields
        .map((field) => {
          const value = data[field.name];
          if (value === undefined || value === null || value === '') {
            return `<tr><td style="color:#888;font-size:0.85rem">${escapeHtml(field.label)}</td><td style="color:#aaa;font-size:0.85rem">—</td></tr>`;
          }
          return `<tr><td style="font-weight:600;font-size:0.85rem;padding:4px 8px 4px 0;vertical-align:top;border-bottom:1px solid #ede4dc">${escapeHtml(field.label)}</td><td style="font-size:0.85rem;padding:4px 0;vertical-align:top;border-bottom:1px solid #ede4dc">${safeFieldValue(value)}</td></tr>`;
        })
        .join('');

      return `
        <div style="margin-bottom:20px">
          <h3 style="font-family:Georgia,serif;font-size:1rem;border-bottom:2px solid #ad5f42;padding-bottom:4px;margin:0 0 8px">${escapeHtml(section.title)}</h3>
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
      <title>Anamnese ${escapeHtml(patientName)} - ${escapeHtml(code)}</title>
      <style>
        @page { margin: 20mm 18mm; }
        body { font-family: Arial, sans-serif; color: #2f2520; font-size: 13px; margin: 0; }
        h1 { font-family: Georgia, serif; font-size: 1.4rem; margin: 0 0 4px; }
        .meta { color: #66564b; font-size: 0.82rem; margin-bottom: 16px; }
        .no-print { margin-top: 24px; text-align: center; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <h1>Anamnese Clínica — ${escapeHtml(code)} ${escapeHtml(patientName)}</h1>
      <div class="meta">
        E-mail: ${escapeHtml(submission.patient_email || data.email || '-')} ·
        Telefone: ${escapeHtml(submission.patient_phone || data.telefone || '-')} ·
        Preenchido em: ${escapeHtml(date)}
      </div>
      ${sectionsHtml}
      <div class="no-print">
        <button onclick="window.print()" style="padding:10px 24px;background:#ad5f42;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:1rem">
          Imprimir / Salvar PDF
        </button>
        <button onclick="window.close()" style="margin-left:12px;padding:10px 24px;background:#eee;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:1rem">
          Fechar
        </button>
      </div>
    </body>
    </html>
  `;

  res.send(html);
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

app.listen(PORT, () => {
  console.log(`Servidor ativo em ${BASE_URL}`);
});
