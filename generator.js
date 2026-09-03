const baseFileInput = document.querySelector('#base-file');
const dataFileInput = document.querySelector('#data-file');
const dataEditor = document.querySelector('#data-editor');
const preview = document.querySelector('#preview');
const statusMessage = document.querySelector('#status');
const generateButton = document.querySelector('#generate');
const downloadButton = document.querySelector('#download');
const copyButton = document.querySelector('#copy');

let baseTemplate = '';
let renderedHtml = '';

// Echappe les caracteres HTML dangereux avant d'inserer une valeur JSON dans du texte.
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Recupere une valeur selon un chemin comme "speaker.name" ou une variable de boucle.
// @index, @first et @last sont fournis par renderSection.
function getValue(context, path, meta) {
  const cleanPath = path.trim();
  if (cleanPath === 'this' || cleanPath === '.') return context;
  if (cleanPath === '@index') return meta.index;
  if (cleanPath === '@first') return meta.first;
  if (cleanPath === '@last') return meta.last;

  let current = context;
  const parts = cleanPath.split('.');
  for (const part of parts) {
    if (part === 'this' || part === '') continue;
    if (current === null || current === undefined) return '';
    current = current[part];
  }
  return current ?? '';
}

// Indique si une valeur doit etre consideree comme presente par #if.
// Un tableau vide est considere comme faux.
function isTruthy(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

// Trouve la fermeture du bloc courant, en tenant compte des blocs imbriques.
function findMatchingBlock(template, startIndex) {
  const tokenPattern = /{{#(?:each|if|unless)\s+[^}]*}}|{{\/(?:each|if|unless)}}|{{else}}/g;
  tokenPattern.lastIndex = startIndex;
  let depth = 1;
  let elseIndex = -1;
  let token;

  while ((token = tokenPattern.exec(template))) {
    if (token[0].startsWith('{{#')) {
      depth += 1;
    } else if (token[0] === '{{else}}' && depth === 1) {
      elseIndex = token.index;
    } else if (token[0].startsWith('{{/')) {
      depth -= 1;
      if (depth === 0) {
        return {
          elseIndex,
          contentEnd: elseIndex >= 0 ? elseIndex : token.index,
          closeEnd: tokenPattern.lastIndex
        };
      }
    }
  }

  throw new Error('Bloc Handlebars non ferme.');
}

// Rend recursivement une portion du modele et gere #each, #if, #unless et #else.
function renderSection(template, context, meta = {}) {
  const blockPattern = /{{#(each|if|unless)\s+([^}]+)}}/g;
  let output = '';
  let cursor = 0;
  let block;

  while ((block = blockPattern.exec(template))) {
    output += replaceValues(template.slice(cursor, block.index), context, meta);
    const match = findMatchingBlock(template, blockPattern.lastIndex);
    const content = template.slice(blockPattern.lastIndex, match.contentEnd);
    const alternate = match.elseIndex >= 0
      ? template.slice(match.elseIndex + '{{else}}'.length, match.closeEnd - (`{{/${block[1]}}}`).length)
      : '';
    const value = getValue(context, block[2], meta);
    const chosenContent = block[1] === 'unless'
      ? (isTruthy(value) ? alternate : content)
      : (block[1] === 'if' ? (isTruthy(value) ? content : alternate) : null);

    if (block[1] === 'each') {
      if (Array.isArray(value)) {
        output += value.map((item, index) => renderSection(content, item, {
          index,
          first: index === 0,
          last: index === value.length - 1
        })).join('');
      } else if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        output += entries.map(([key, item], index) => renderSection(content, item, {
          key,
          index,
          first: index === 0,
          last: index === entries.length - 1
        })).join('');
      }
    } else {
      output += renderSection(chosenContent, context, meta);
    }

    cursor = match.closeEnd;
    blockPattern.lastIndex = cursor;
  }

  output += replaceValues(template.slice(cursor), context, meta);
  return output;
}

// Formate le texte : convertit \n en <br> et applique les formatages markdown.
// **texte** -> <strong>texte</strong> (gras)
// *texte* -> <em>texte</em> (italique)
// __texte__ -> <u>texte</u> (souligné)
// `texte` -> <span style="font-family:monospace;">texte</span> (monospace)
function formatNewlines(value) {
  let text = String(value).replace(/\n/g, '<br>');
  text = text.replace(/`(.+?)`/g, '<span style="font-family:monospace;">$1</span>');  // `monospace`
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');  // **gras**
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');              // *italique*
  text = text.replace(/__(.+?)__/g, '<u>$1</u>');                // __souligné__
  text = text.replace(/\|\|(.+?)\|\|/g, '<p>$1</p>');            // ||paragraphe||
  text = text.replace(/\[s](.+?)\[s]/g, '<small>$1</small>');   // [s]small[s]
  
  return text;
}

// Remplace les variables simples : {{value}} est echappe, {{{value}}} ne l'est pas.
function replaceValues(text, context, meta) {
  return text.replace(/{{{\s*([^{}]+?)\s*}}}|{{\s*([^{}#\/][^{}]*?)\s*}}/g, (_, rawPath, escapedPath) => {
    const path = (rawPath || escapedPath).trim();
    const value = getValue(context, path, meta);
    if (rawPath) {
      // Pour {{{...}}}, appliquer le helper si c'est du texte
      return typeof value === 'string' ? formatNewlines(value) : String(value);
    } else {
      // Pour {{...}}, échapper + convertir \n en <br>
      return formatNewlines(escapeHtml(value));
    }
  });
}

// Lance le rendu avec l'objet JSON complet comme contexte initial.
function renderTemplate(template, data) {
  return renderSection(template, data);
}

// Met a jour le message d'etat et applique le style d'erreur si necessaire.
function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

// Lit le contenu texte d'un fichier selectionne dans un input file.
async function readTextFile(file) {
  return file.text();
}

// Charge la base HTML puis actualise l'apercu si les donnees sont disponibles.
async function loadBaseFile() {
  const file = baseFileInput.files[0];
  if (!file) return;
  baseTemplate = await readTextFile(file);
  setStatus(`Base chargee : ${file.name}`);
  render();
}

// Charge le JSON dans l'editeur puis actualise l'apercu.
async function loadDataFile() {
  const file = dataFileInput.files[0];
  if (!file) return;
  dataEditor.value = await readTextFile(file);
  setStatus(`Donnees chargees : ${file.name}`);
  render();
}

// Parse le contenu de l'editeur et transforme les erreurs JSON en message lisible.
function getData() {
  try {
    return JSON.parse(dataEditor.value);
  } catch (error) {
    throw new Error(`JSON invalide : ${error.message}`);
  }
}

// Rend la fiche avec la base et les donnees actuelles.
// En cas d'erreur, l'export est desactive pour eviter un fichier incomplet.
function render() {
  if (!baseTemplate || !dataEditor.value.trim()) return;
  try {
    renderedHtml = renderTemplate(baseTemplate, getData());
    preview.srcdoc = renderedHtml;
    setStatus('Apercu mis a jour.');
    downloadButton.disabled = false;
    copyButton.disabled = false;
  } catch (error) {
    renderedHtml = '';
    downloadButton.disabled = true;
    copyButton.disabled = true;
    setStatus(error.message, true);
  }
}

// Encapsule le fragment rendu dans un document HTML autonome avec son titre.
function createDocument(fragment, data) {
  const title = escapeHtml(data.name || 'Fiche de personnage');
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
${fragment}
</body>
</html>`;
}

// Cree un Blob HTML et declenche le telechargement de la fiche generee.
function download() {
  if (!renderedHtml) return;
  const data = getData();
  const documentText = createDocument(renderedHtml, data);
  const blob = new Blob([documentText], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(data.name || 'personnage').replace(/[^a-z0-9_-]+/gi, '_')}.html`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Fichier HTML cree.');
}

// Copie le document HTML autonome dans le presse-papiers.
async function copy() {
  if (!renderedHtml) return;
  const data = getData();
  const documentText = createDocument(renderedHtml, data);

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(documentText);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = documentText;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    setStatus('HTML copie dans le presse-papiers.');
  } catch (error) {
    setStatus('Impossible de copier le HTML.', true);
  }
}

baseFileInput.addEventListener('change', loadBaseFile);
dataFileInput.addEventListener('change', loadDataFile);
dataEditor.addEventListener('input', render);
generateButton.addEventListener('click', render);
downloadButton.addEventListener('click', download);
copyButton.addEventListener('click', copy);
