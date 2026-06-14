// editor.js - DeepEditor
let editor = null;
let currentFilePath = null;

function initEditor() {
    const textarea = document.getElementById('code-editor');
    if (textarea) {
        editor = CodeMirror.fromTextArea(textarea, {
            lineNumbers: true,
            theme: 'dracula',
            mode: 'javascript',
            lineWrapping: true,
            tabSize: 4,
            indentUnit: 4
        });
    }
}

async function openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        currentFilePath = file.name;
        document.getElementById('current-file').innerText = file.name;
        const ext = file.name.split('.').pop();
        if (ext === 'py') editor.setOption('mode', 'python');
        else if (ext === 'js') editor.setOption('mode', 'javascript');
        else editor.setOption('mode', 'text/plain');
        const content = await file.text();
        editor.setValue(content);
        if (typeof addChatMessage === 'function') addChatMessage(`📁 تم فتح ${file.name}`, 'system');
    };
    input.click();
}

function saveFile() {
    if (!editor) return;
    const content = editor.getValue();
    const blob = new Blob([content], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFilePath || 'code.txt';
    a.click();
    URL.revokeObjectURL(url);
    if (typeof addChatMessage === 'function') addChatMessage(`💾 تم حفظ ${currentFilePath || 'code.txt'}`, 'system');
}

async function runCode() {
    const code = editor.getValue();
    if (typeof addChatMessage === 'function') addChatMessage(`🚀 جاري تحليل الكود... (${code.length} حرف)`, 'system');
}

async function askAI(requestType) {
    if (!editor) return;
    const currentCode = editor.getValue();
    if (!currentCode.trim()) {
        if (typeof addChatMessage === 'function') addChatMessage("⚠️ لا يوجد كود لتحليله.", "system");
        return;
    }
    let prompt = `[الكود الحالي]\n${currentCode}\n\nالطلب: ${requestType}`;
    const input = document.getElementById('chat-input');
    if (input) {
        input.value = prompt;
        sendMessage();
    }
}

window.initEditor = initEditor;
window.openFile = openFile;
window.saveFile = saveFile;
window.runCode = runCode;
window.askAI = askAI;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEditor);
else initEditor();