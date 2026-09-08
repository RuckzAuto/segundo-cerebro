import express from 'express';
import { db, initDb } from './lib/db.mjs';
import crypto from 'crypto';
import { processMessage } from './lib/brain.mjs';
import { handleUpdate, telegramRequest } from './lib/telegram.mjs';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/folders', async (req, res) => {
  try {
    const rs = await db.execute('SELECT * FROM folders ORDER BY path ASC');
    res.json(rs.rows || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar pastas' });
  }
});

app.post('/api/folders', async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    
    let path = name;
    if (parent_id) {
      const parentRs = await db.execute({
        sql: 'SELECT path FROM folders WHERE id = ?',
        args: [parent_id]
      });
      if (parentRs.rows.length > 0) {
        path = parentRs.rows[0].path + '/' + name;
      }
    }
    
    const id = crypto.randomUUID();
    await db.execute({
      sql: 'INSERT INTO folders (id, parent_id, name, path) VALUES (?, ?, ?, ?)',
      args: [id, parent_id || null, name, path]
    });
    
    res.json({ id, parent_id: parent_id || null, name, path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar pasta' });
  }
});

app.get('/api/folders/:id/notes', async (req, res) => {
  try {
    const rs = await db.execute({
      sql: 'SELECT * FROM notes WHERE folder_id = ? ORDER BY created_at DESC',
      args: [req.params.id]
    });
    res.json(rs.rows || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar notas' });
  }
});

app.post('/api/folders/:id/notes', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    
    const id = crypto.randomUUID();
    await db.execute({
      sql: 'INSERT INTO notes (id, folder_id, content) VALUES (?, ?, ?)',
      args: [id, req.params.id, content]
    });
    
    res.json({ id, folder_id: req.params.id, content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar nota' });
  }
});

app.delete('/api/folders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const subRs = await db.execute({
      sql: 'SELECT count(*) as count FROM folders WHERE parent_id = ?',
      args: [id]
    });
    
    if (subRs.rows[0].count > 0) {
      return res.status(400).json({ error: 'Pasta possui subpastas e não pode ser excluída' });
    }
    
    await db.execute({ sql: 'DELETE FROM notes WHERE folder_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM folders WHERE id = ?', args: [id] });
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir pasta' });
  }
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Segundo Cérebro</title>
  <style>
    body { font-family: sans-serif; background: #f4f4f4; padding: 20px; display: flex; gap: 20px; margin: 0; }
    .sidebar { width: 300px; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); overflow-y: auto; height: calc(100vh - 40px); }
    .content { flex-grow: 1; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); overflow-y: auto; height: calc(100vh - 40px); }
    ul { list-style-type: none; padding-left: 20px; }
    .folder { cursor: pointer; color: #0066cc; text-decoration: underline; font-weight: bold; }
    .folder:hover { color: #004499; }
    .notes-list { margin-top: 20px; }
    .note { background: #eee; padding: 10px; margin-bottom: 10px; border-radius: 4px; white-space: pre-wrap; font-family: monospace; }
    form { margin-top: 10px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
    input, select, textarea, button { padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; }
    button { background: #0066cc; color: white; border: none; cursor: pointer; font-weight: bold; }
    button:hover { background: #004499; }
    .btn-danger { background: #cc0000; }
    .btn-danger:hover { background: #990000; }
  </style>
</head>
<body>
  <div class="sidebar">
    <h2>Segundo Cérebro</h2>
    <hr>
    <h3>Pastas</h3>
    <div id="tree">Carregando...</div>
    <hr>
    <h4>Nova Pasta</h4>
    <form id="new-folder-form">
      <input type="text" id="folder-name" placeholder="Nome da pasta" required>
      <select id="folder-parent">
        <option value="">Raiz</option>
      </select>
      <button type="submit">Criar Pasta</button>
    </form>
  </div>
  <div class="content">
    <h3 id="current-folder-title" style="color: #666;">Selecione uma pasta à esquerda</h3>
    <button id="delete-folder-btn" class="btn-danger" style="display: none;">Excluir Pasta</button>
    
    <div id="notes-section" style="display: none; margin-top: 20px;">
      <hr>
      <h4>Nova Nota</h4>
      <form id="new-note-form">
        <textarea id="note-content" rows="6" placeholder="Escreva o conteúdo da sua nota aqui..." required></textarea>
        <button type="submit">Adicionar Nota</button>
      </form>
      <hr>
      <h4>Notas</h4>
      <div class="notes-list" id="notes-list">Nenhuma nota ainda.</div>
    </div>
  </div>

  <script>
    let currentFolderId = null;

    async function loadFolders() {
      try {
        const res = await fetch('/api/folders');
        const folders = await res.json();
        
        const select = document.getElementById('folder-parent');
        select.innerHTML = '<option value="">Raiz</option>';
        folders.forEach(f => {
          const option = document.createElement('option');
          option.value = f.id;
          option.textContent = f.path;
          select.appendChild(option);
        });

        const tree = document.getElementById('tree');
        tree.innerHTML = '';
        if (folders.length === 0) {
           tree.innerHTML = '<p>Nenhuma pasta criada.</p>';
           return;
        }
        
        const buildTree = (parentId, container) => {
          const children = folders.filter(f => f.parent_id === parentId);
          if (children.length === 0) return;
          
          const ul = document.createElement('ul');
          if (parentId === null) ul.style.paddingLeft = '0';

          children.forEach(child => {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.className = 'folder';
            span.textContent = child.name;
            span.onclick = () => selectFolder(child);
            li.appendChild(span);
            buildTree(child.id, li);
            ul.appendChild(li);
          });
          container.appendChild(ul);
        };

        buildTree(null, tree);
      } catch (e) {
        console.error(e);
      }
    }

    async function selectFolder(folder) {
      currentFolderId = folder.id;
      document.getElementById('current-folder-title').textContent = 'Pasta: ' + folder.path;
      document.getElementById('current-folder-title').style.color = '#000';
      document.getElementById('notes-section').style.display = 'block';
      document.getElementById('delete-folder-btn').style.display = 'inline-block';
      loadNotes();
    }

    async function loadNotes() {
      if (!currentFolderId) return;
      try {
        const res = await fetch('/api/folders/' + currentFolderId + '/notes');
        const notes = await res.json();
        
        const list = document.getElementById('notes-list');
        list.innerHTML = '';
        if (notes.length === 0) {
            list.innerHTML = '<p>Nenhuma nota nesta pasta.</p>';
        } else {
            notes.forEach(n => {
              const div = document.createElement('div');
              div.className = 'note';
              div.textContent = n.content;
              list.appendChild(div);
            });
        }
      } catch(e) { console.error(e); }
    }

    document.getElementById('new-folder-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('folder-name').value;
      const parent_id = document.getElementById('folder-parent').value;
      
      try {
          await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, parent_id: parent_id || null })
          });
          
          document.getElementById('folder-name').value = '';
          loadFolders();
      } catch(e) { console.error(e); }
    };

    document.getElementById('new-note-form').onsubmit = async (e) => {
      e.preventDefault();
      if (!currentFolderId) return;
      
      const content = document.getElementById('note-content').value;
      try {
          await fetch('/api/folders/' + currentFolderId + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
          });
          
          document.getElementById('note-content').value = '';
          loadNotes();
      } catch(e) { console.error(e); }
    };

    document.getElementById('delete-folder-btn').onclick = async () => {
      if (!currentFolderId) return;
      if (!confirm('Deseja excluir a pasta e suas notas?')) return;
      
      try {
          const res = await fetch('/api/folders/' + currentFolderId, { method: 'DELETE' });
          if (res.ok) {
            currentFolderId = null;
            document.getElementById('current-folder-title').textContent = 'Selecione uma pasta à esquerda';
            document.getElementById('current-folder-title').style.color = '#666';
            document.getElementById('notes-section').style.display = 'none';
            document.getElementById('delete-folder-btn').style.display = 'none';
            loadFolders();
          } else {
            const err = await res.json();
            alert(err.error || 'Erro ao excluir');
          }
      } catch(e) { console.error(e); }
    };

    loadFolders();
  </script>
</body>
</html>
  `);
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, chat_id } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });
    const reply = await processMessage(message, chat_id || 'default');
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no chat' });
  }
});

app.post('/webhook/:secret', async (req, res) => {
  const secret = req.params.secret;
  if (secret !== process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(404).send('Not found');
  }
  res.sendStatus(200);
  try {
    await handleUpdate(req.body, process.env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
  }
});

app.listen(PORT, async () => {
  console.log('[SERVER] Servidor web rodando na porta ' + PORT);
  await initDb();
  
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  
  if (telegramToken && renderUrl) {
    const webhookUrl = `${renderUrl}/webhook/${telegramToken}`;
    try {
      await telegramRequest(telegramToken, 'setWebhook', { url: webhookUrl });
      console.log('[WEBHOOK] ✅ Webhook registrado automaticamente: ' + webhookUrl);
    } catch (err) {
      console.error('[WEBHOOK] ❌ Erro ao registrar webhook:', err.message);
    }
  } else {
    console.warn('[WEBHOOK] ⚠️ RENDER_EXTERNAL_URL ou TELEGRAM_BOT_TOKEN não definidos — webhook não registrado.');
  }
});

