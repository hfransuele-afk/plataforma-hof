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

app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
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
    files: 16
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Apenas imagens são permitidas nos uploads.'));
  }
});

const uploadPatientFiles = upload.fields([
  { name: 'facePhotos', maxCount: 8 },
  { name: 'productPhotos', maxCount: 12 }
]);

function setupDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patient_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      patient_name_hint TEXT,
      patient_email_hint TEXT,
      is_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      submission_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id),
      FOREIGN KEY(submission_id) REFERENCES submissions(id)
    );
  `);
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
  const rows = db
    .prepare(
      `
      SELECT
        l.id,
        l.token,
        l.patient_name_hint,
        l.patient_email_hint,
        l.created_at,
        l.is_used,
        s.id AS submission_id,
        s.created_at AS submitted_at,
        json_extract(s.data_json, '$.nomeCompleto') AS nome_completo,
        json_extract(s.data_json, '$.email') AS email_resposta
      FROM patient_links l
      LEFT JOIN submissions s ON s.link_id = l.id
      ORDER BY l.id DESC
      `
    )
    .all();

  const linkRows = rows
    .map((row) => {
      const patientLink = `${BASE_URL}/paciente/${row.token}`;
      const status = row.is_used ? '<span class="chip done">Respondido</span>' : '<span class="chip pending">Aguardando</span>';
      const patientName = row.nome_completo || row.patient_name_hint || '-';
      const patientEmail = row.email_resposta || row.patient_email_hint || '-';
      const actions = row.submission_id
        ? `<a class="btn tiny" href="/admin/submissions/${row.submission_id}">Ver resposta</a>`
        : '<span class="muted">Sem resposta</span>';

      return `
        <tr>
          <td>${status}</td>
          <td>${escapeHtml(patientName)}</td>
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
        <a class="btn" href="/admin/chat">Chat LLM</a>
        <form method="post" action="/logout">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
          <button class="btn ghost" type="submit">Sair</button>
        </form>
      </div>
    </header>

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

  db.prepare(
    `
      INSERT INTO patient_links (token, patient_name_hint, patient_email_hint, created_at)
      VALUES (?, ?, ?, ?)
    `
  ).run(token, patientNameHint, patientEmailHint, nowIso());

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
      <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrfToken)}">
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

    if (!verifyCsrf(req)) {
      res.status(403).send('CSRF inválido.');
      return;
    }

    const token = String(req.params.token || '');
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
      'INSERT INTO submissions (link_id, token, data_json, created_at) VALUES (?, ?, ?, ?)'
    );

    const tx = db.transaction(() => {
      const result = insertSubmission.run(link.id, token, JSON.stringify(payload), nowIso());
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

      db.prepare('UPDATE patient_links SET is_used = 1, used_at = ? WHERE id = ?').run(nowIso(), link.id);
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

app.get('/admin/submissions/:id', requireAuth, (req, res) => {
  const submissionId = Number(req.params.id);
  const submission = db
    .prepare(
      `
      SELECT s.*, l.patient_name_hint, l.patient_email_hint
      FROM submissions s
      JOIN patient_links l ON l.id = s.link_id
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

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Resposta enviada em ${escapeHtml(new Date(submission.created_at).toLocaleString('pt-BR'))}</p>
        <h1>${escapeHtml(data.nomeCompleto || submission.patient_name_hint || 'Paciente')}</h1>
        <p class="muted">${escapeHtml(data.email || submission.patient_email_hint || '-')}</p>
      </div>
      <div class="header-actions">
        <a class="btn" href="/admin">Voltar ao painel</a>
        <a class="btn primary" href="/admin/chat?submissionId=${submissionId}">Conversar com IA sobre este caso</a>
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

  const submissions = db
    .prepare(
      `
      SELECT
        s.id,
        s.created_at,
        json_extract(s.data_json, '$.nomeCompleto') AS nome,
        json_extract(s.data_json, '$.queixaPrincipal') AS queixa
      FROM submissions s
      ORDER BY s.id DESC
      LIMIT 200
      `
    )
    .all();

  const messages = db
    .prepare('SELECT * FROM chat_messages ORDER BY id ASC LIMIT 200')
    .all();

  const messagesHtml = messages
    .map((msg) => {
      const cssRole = msg.role === 'assistant' ? 'assistant' : 'user';
      const submissionTag = msg.submission_id
        ? `<span class="msg-tag">Caso #${msg.submission_id}</span>`
        : '';
      return `
        <article class="chat-message ${cssRole}">
          <header>
            <strong>${msg.role === 'assistant' ? 'LLM' : 'Você'}</strong>
            ${submissionTag}
            <span>${escapeHtml(new Date(msg.created_at).toLocaleString('pt-BR'))}</span>
          </header>
          <p>${escapeHtml(msg.content)}</p>
        </article>
      `;
    })
    .join('');

  const options = submissions
    .map((item) => {
      const labelName = item.nome || `Caso ${item.id}`;
      const selected = selectedSubmissionId === item.id ? 'selected' : '';
      return `<option value="${item.id}" ${selected}>#${item.id} - ${escapeHtml(labelName)}</option>`;
    })
    .join('');

  const body = `
    <header class="panel header-panel">
      <div>
        <p class="eyebrow">Assistente com LLM via API</p>
        <h1>Chat clínico</h1>
        <p class="muted">Use para interpretar respostas e montar recomendações preliminares.</p>
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

  if (!message) {
    res.redirect('/admin/chat?error=Digite uma mensagem');
    return;
  }

  db.prepare(
    `
    INSERT INTO chat_messages (admin_id, submission_id, role, content, created_at)
    VALUES (?, ?, 'user', ?, ?)
    `
  ).run(req.session.adminId, submissionId, message, nowIso());

  try {
    const assistantReply = await callLlm(message, submissionId);
    db.prepare(
      `
      INSERT INTO chat_messages (admin_id, submission_id, role, content, created_at)
      VALUES (?, ?, 'assistant', ?, ?)
      `
    ).run(req.session.adminId, submissionId, assistantReply, nowIso());
  } catch (error) {
    db.prepare(
      `
      INSERT INTO chat_messages (admin_id, submission_id, role, content, created_at)
      VALUES (?, ?, 'assistant', ?, ?)
      `
    ).run(req.session.adminId, submissionId, `Erro ao consultar LLM: ${error.message}`, nowIso());
  }

  const qs = submissionId ? `?submissionId=${submissionId}` : '';
  res.redirect(`/admin/chat${qs}`);
});

async function callLlm(currentMessage, submissionId) {
  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4.1-mini';

  if (!apiKey) {
    throw new Error('Defina LLM_API_KEY no arquivo .env');
  }

  const recentMessages = db
    .prepare('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 12')
    .all()
    .reverse();

  const contextBlocks = [];

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

      contextBlocks.push(`Caso selecionado #${submission.id}`);
      contextBlocks.push(`Fotos do rosto enviadas: ${submission.qtd_face}`);
      contextBlocks.push(`Fotos de produtos enviadas: ${submission.qtd_produtos}`);
      contextBlocks.push('Resumo das respostas:');
      contextBlocks.push(summaryLines.join('\n'));
    }
  }

  const systemPrompt = [
    'Você é uma assistente de suporte para consultoria de skincare.',
    'Responda em português do Brasil.',
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
    throw new Error(`API retornou ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('A API respondeu sem conteúdo em choices[0].message.content');
  }

  return String(content).trim();
}

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
