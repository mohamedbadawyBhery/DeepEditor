
// src/toolsProvider.ts
import { text, tool, type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { spawn } from "child_process";
import { rm, writeFile, readFile, mkdir, cp, rename } from "fs/promises";
import { join, normalize, dirname } from "path";
import { z } from "zod";
import { existsSync } from "fs";
import ExcelJS from "exceljs";

/* --------------- Helper Functions (not registered as tools) --------------- */
async function ensureDirectory(dirPath: string) {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

async function runCommand(options: {
  cmd: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  stageLabel?: string;
}): Promise<{ success: boolean; stdout: string; stderr: string; code: number }> {
  const { cmd, args = [], cwd = process.cwd(), timeoutMs = 0, stageLabel } = options;
  return await new Promise<{ success: boolean; stdout: string; stderr: string; code: number }>((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    let killedByTimeout = false;
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill(); } catch {}
      }, timeoutMs);
    }
    child.on('close', async (code) => {
      if (timer) clearTimeout(timer);
      const timestamp = new Date().toISOString();
      const header = stageLabel ? `--- ${stageLabel} ---` : `--- ${cmd} ${args.join(' ')} ---`;
      const logEntry = `

${header} ${timestamp}
EXIT CODE: ${code}${killedByTimeout ? ' (timeout)' : ''}
STDOUT:
${stdout}
STDERR:
${stderr}
`;
      try {
        const logDir = join(process.cwd(), 'copilot_unit');
        await ensureDirectory(logDir);
        await writeFile(join(logDir, 'execution_trace.md'), logEntry, { flag: 'a' });
      } catch {}
      const exitCode = typeof code === 'number' ? code : -1;
      resolve({ success: exitCode === 0 && !killedByTimeout, stdout: stdout.trim(), stderr: stderr.trim(), code: exitCode });
    });
    child.on('error', async (err) => {
      if (timer) clearTimeout(timer);
      const timestamp = new Date().toISOString();
      const header = stageLabel ? `--- ${stageLabel} ERROR ---` : `--- ${cmd} ERROR ---`;
      const logEntry = `

${header} ${timestamp}
ERROR: ${String(err)}
`;
      try {
        const logDir = join(process.cwd(), 'copilot_unit');
        await ensureDirectory(logDir);
        await writeFile(join(logDir, 'execution_trace.md'), logEntry, { flag: 'a' });
      } catch {}
      resolve({ success: false, stdout: stdout.trim(), stderr: String(err), code: -1 });
    });
  });
}

/* ------------------------------ Core Tools ------------------------------- */
export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  const tools: Tool[] = [];

  // وضع مفتوح بشكل افتراضي — السماح بالمسارات المطلقة والنسبيّة بدون قيود
  const UNSAFE = true;

  // الجذر الموحّد للبيئة المعزولة
  const targetBase = normalize("D:\\\\bido");
  await ensureDirectory(targetBase);

  /* ---------------------------- writeFile ---------------------------- */
  tools.push(tool({
    name: "writeFile",
    description: text`اكتب/أنشئ الملف في المسار المحدد (UTF-8) بدون قيود مسارات.`,
    parameters: { file: z.string().min(1), content: z.string() },
    implementation: async ({ file, content }) => {
      const filePath = resolveInsideBase(targetBase, file, UNSAFE);
      await ensureDirectory(join(filePath, ".."));
      await writeFile(filePath, content, "utf-8");
      return { success: true, message: `تم كتابة الملف ${file}` };
    }
  }));

  /* ---------------------------- readFile ---------------------------- */
  tools.push(tool({
    name: "readFile",
    description: text`اقرأ الملف من أي مسار وأرجع المحتوى كاملًا (UTF-8).`,
    parameters: { file: z.string().min(1) },
    implementation: async ({ file }) => {
      const filePath = resolveInsideBase(targetBase, file, UNSAFE);
      if (!existsSync(filePath)) return { success: false, error: `الملف ${file} غير موجود.` };
      const content = await readFile(filePath, "utf-8");
      return { success: true, content };
    }
  }));

  /* --------------------------- renameFile --------------------------- */
  tools.push(tool({
    name: "renameFile",
    description: text`أعد تسمية/انقل الملف لأي مسار هدف، وأنشئ المجلدات الناقصة تلقائيًا.`,
    parameters: { oldName: z.string().min(1), newName: z.string().min(1) },
    implementation: async ({ oldName, newName }) => {
      const oldPath = resolveInsideBase(targetBase, oldName, UNSAFE);
      const newPath = resolveInsideBase(targetBase, newName, UNSAFE);
      if (!existsSync(oldPath)) return { success: false, error: `الملف ${oldName} غير موجود.` };
      await ensureDirectory(join(newPath, ".."));
      await rename(oldPath, newPath);
      return { success: true, message: `تمت إعادة التسمية إلى ${newName}` };
    }
  }));
  /* ---------------------------- deleteFile --------------------------- */
  tools.push(tool({
    name: "deleteFile",
    description: text`احذف ملفًا محددًا (قوة).`,
    parameters: { file: z.string().min(1) },
    implementation: async ({ file }) => {
      const filePath = resolveInsideBase(targetBase, file, UNSAFE);
      if (!existsSync(filePath)) return { success: false, error: `الملف ${file} غير موجود.` };
      await rm(filePath, { force: true });
      return { success: true, message: `تم حذف الملف ${file}` };
    }
  }));
   /* ------------------------------ copyFile ---------------------------- */
  tools.push(tool({
    name: "copyFile",
    description: text`انسخ الملف لأي مسار جديد، وأنشئ المسارات الناقصة.`,
    parameters: { from: z.string().min(1), to: z.string().min(1), overwrite: z.boolean().optional() },
    implementation: async ({ from, to, overwrite }) => {
      const fromPath = resolveInsideBase(targetBase, from, UNSAFE);
      const toPath = resolveInsideBase(targetBase, to, UNSAFE);
      if (!existsSync(fromPath)) return { success: false, error: `الملف ${from} غير موجود.` };
      await ensureDirectory(join(toPath, ".."));
      await cp(fromPath, toPath, { force: !!overwrite, errorOnExist: !overwrite });
      return { success: true, message: `تم نسخ ${from} إلى ${to}` };
    }
  }));
 /* ---------------------- listDirectoryStructure --------------------- */
  tools.push(tool({
    name: "listDirectoryStructure",
    description: text`اعرض محتويات المجلد (اسم/نوع/حجم/تعديل) لأي مسار.`,
    parameters: { folder: z.string().default("") },
    implementation: async ({ folder }) => {
      const dirPath = resolveInsideBase(targetBase, folder || "", UNSAFE);
      if (!existsSync(dirPath)) return { success: false, error: `المجلد ${folder || "[الجذر]"} غير موجود.` };
      const { readdir, stat } = await import("fs/promises");
      const entries = await readdir(dirPath, { withFileTypes: true });
      const structure = await Promise.all(entries.map(async (entry) => {
        const fullPath = join(dirPath, entry.name);
        const stats = await stat(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? "مجلد" : "ملف",
          size: entry.isDirectory() ? "-" : `${(stats.size / 1024).toFixed(2)} KB`,
          modified: stats.mtime.toISOString()
        };
      }));
      return { success: true, folder: folder || "[الجذر]", items: structure };
    }
  }));
 /* --------------------------- createFolder -------------------------- */
  tools.push(tool({
  name: "createFolder",
  description: text`أنشئ مجلدًا في أي مسار مطلق/نسبي.`,
  parameters: { folder: z.string().min(1) },
  implementation: async ({ folder }) => {
  const folderPath = resolveInsideBase(targetBase, folder, UNSAFE);
  await mkdir(folderPath, { recursive: true });
  return { success: true, message: `تم إنشاء المجلد ${folder}` };
  }
  }));
/* --------------------------- deleteFolder -------------------------- */
  tools.push(tool({
  name: "deleteFolder",
  description: text`احذف المجلد (قوة/تراكمي).`,
  parameters: { folder: z.string().min(1) },
  implementation: async ({ folder }) => {
  const folderPath = resolveInsideBase(targetBase, folder, UNSAFE);
  if (!existsSync(folderPath)) return { success: false, error: `المجلد ${folder} غير موجود.` };
  await rm(folderPath, { recursive: true, force: true });
  return { success: true, message: `تم حذف المجلد ${folder}` };
  }
  }));

 /* --------------------------- renameFolder -------------------------- */
tools.push(tool({
  name: "renameFolder",
  description: text`أعد تسمية مجلد موجود.`,
  parameters: { old_folder_path: z.string().min(1), new_folder_name: z.string().min(1) },
  implementation: async ({ old_folder_path, new_folder_name }) => {
  try {
    await rename(old_folder_path, new_folder_name);
    return { success: true, message: `تمت إعادة تسمية المجلد ${old_folder_path} إلى ${new_folder_name}` };
  } catch (error: any) {  // ✅ التصحيح: إضافة ": any"
    console.error(error);
    return { success: false, error: `فشل إعادة التسمية: ${error.message}` };
  }
  }
}));

  /* --------------------------- moveFolder -------------------------- */
tools.push(tool({
  name: "moveFolder",
  description: text`انقل مجلد من مكان إلى آخر.`,
  parameters: { source_folder: z.string().min(1), destination_folder: z.string().min(1) },
  implementation: async ({ source_folder, destination_folder }) => {
  try {
    await rename(source_folder, destination_folder);  // ✅ التصحيح: rename بدلاً من mv
    return { success: true, message: `تم نقل المجلد ${source_folder} إلى ${destination_folder}` };
  } catch (error: any) {  // ✅ التصحيح: إضافة ": any"
    console.error(error);
    return { success: false, error: `فشل النقل: ${error.message}` };
  }
  }
}));

    /* --------------------------- getCurrentTime ------------------------ */
  tools.push(tool({
    name: "getCurrentTime",
    description: text`أرجع الوقت الحالي والتوقيت الدولي.`,
    parameters: {},
    implementation: async () => {
      const now = new Date();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      let time: string;
      try {
        time = new Intl.DateTimeFormat('ar', { timeStyle: 'medium' }).format(now);
      } catch {
        time = now.toLocaleTimeString();
      }
      return { success: true, time, iso: now.toISOString(), timezone };
    }
  }));

  /* --------------------------- getCurrentDate ------------------------ */
  tools.push(tool({
    name: "getCurrentDate",
    description: text`أرجع التاريخ الحالي بصيغتين محليّة وISO.`,
    parameters: {},
    implementation: async () => {
      const today = new Date();
      const isoDate = today.toISOString().slice(0, 10);
      let date: string;
      try {
        date = new Intl.DateTimeFormat('ar', { dateStyle: 'short' }).format(today);
      } catch {
        date = today.toLocaleDateString();
      }
      return { success: true, date, isoDate };
    }
  }));

  /* --------------------------- markAwareness -------------------------- */
  tools.push(tool({
    name: "markAwareness",
    description: text`سجّل لحظة إدراك في ملف Markdown.`,
    parameters: { insight: z.string().min(10) },
    implementation: async ({ insight }) => {
      const filePath = join(targetBase, "model_reflection.md");
      const entry = `
### لحظة إدراك
- ${new Date().toISOString()}
- ${insight}
`;
      await writeFile(filePath, entry, { flag: "a" });
      return { success: true, message: "تم تسجيل الإدراك." };
    }
  }));

  /* -------------------------- saveContextMemory ----------------------- */
  tools.push(tool({
    name: "saveContextMemory",
    description: text`احفظ إدخالات ذاكرة سياقية في JSON هرمي تحت D:\\bido\\memory\\<namespace>.`,
    parameters: {
      namespace: z.string().min(1).default("default"),
      entry: z.object({
        role: z.string().default("system"),
        content: z.string().min(1),
        tags: z.array(z.string()).default([]),
        metadata: z.record(z.any()).default({})
      })
    },
    implementation: async ({ namespace, entry }) => {
      const memDir = resolveInsideBase(targetBase, join("memory", namespace), UNSAFE);
      await mkdir(memDir, { recursive: true });
      const memPath = join(memDir, "context_memory.json");
      const prev = existsSync(memPath) ? JSON.parse(await readFile(memPath, "utf-8")) : { entries: [] };
      const record = { id: Date.now().toString(36), timestamp: new Date().toISOString(), ...entry };
      prev.entries.push(record);
      await writeFile(memPath, JSON.stringify(prev, null, 2), "utf-8");
      return { success: true, path: memPath, count: prev.entries.length };
    }
  }));

  /* -------------------------- loadContextMemory ----------------------- */
  tools.push(tool({
    name: "loadContextMemory",
    description: text`حمّل إدخالات الذاكرة السياقية مع مرشح اختياري بالعلامات.`,
    parameters: { namespace: z.string().min(1).default("default"), tag: z.string().optional() },
    implementation: async ({ namespace, tag }) => {
      const memDir = resolveInsideBase(targetBase, join("memory", namespace), UNSAFE);
      const memPath = join(memDir, "context_memory.json");
      if (!existsSync(memPath)) return { success: true, entries: [] };
      const data = JSON.parse(await readFile(memPath, "utf-8"));
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const filtered = tag ? entries.filter((e: any) => Array.isArray(e.tags) && e.tags.includes(tag)) : entries;
      return { success: true, entries: filtered };
    }
  }));

  /* -------------------------- readExcelSheet -------------------------- */
  tools.push(tool({
    name: "readExcelSheet",
    description: text`اقرأ ورقة من ملف Excel (إن وجد) وأرجع الصفوف كما هي.`,
    parameters: { file: z.string().min(1), sheet: z.string().optional() },
    implementation: async ({ file, sheet }) => {
      const filePath = resolveInsideBase(targetBase, file.endsWith('.xlsx') ? file : `${file}.xlsx`, UNSAFE);
      const wb = new ExcelJS.Workbook();
      if (!existsSync(filePath)) {
        return { success: false, error: `الملف غير موجود: ${file}` };
      }
      await wb.xlsx.readFile(filePath);
      const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
      if (!ws) return { success: false, error: `لا توجد ورقة مطابقة` };
      const rows: any[] = [];
      ws.eachRow((row) => {
        const vals: any[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => { vals.push(cell.value); });
        rows.push(vals);
      });
      return { success: true, rows, sheet: ws.name };
    }
  }));

  /* -------------------------- appendExcelRow -------------------------- */
  tools.push(tool({
    name: "appendExcelRow",
    description: text`أضف صفًا إلى ورقة Excel (أنشئ الملف/الورقة إن لزم).`,
    parameters: { file: z.string().min(1), sheet: z.string().optional(), row: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1) },
    implementation: async ({ file, sheet, row }) => {
      const filePath = resolveInsideBase(targetBase, file.endsWith('.xlsx') ? file : `${file}.xlsx`, UNSAFE);
      const wb = new ExcelJS.Workbook();
      if (existsSync(filePath)) { await wb.xlsx.readFile(filePath); }
      let ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
      if (!ws) { ws = wb.addWorksheet(sheet || 'Sheet1'); }
      ws.addRow(row);
      await ensureDirectory(dirname(filePath));
      await wb.xlsx.writeFile(filePath);
      return { success: true, message: `تمت إضافة صف إلى ${ws.name}`, path: filePath };
    }
  }));

  /* ----------------------------- runCode ------------------------------ */
  tools.push(tool({
    name: "runCode",
    description: text`نفّذ JavaScript أو Python من نص/ملف، بمهلة تصل إلى 3600000ms (ساعة).`,
    parameters: {
      language: z.enum(["javascript","python"]).default("javascript"),
      code: z.string().optional(),
      file: z.string().optional(),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().int().min(0).max(3600000).optional()
    },
    implementation: async ({ language, code, file, args, timeoutMs }) => {
      const argv = Array.isArray(args) ? args : [];
      let scriptPath: string | undefined;
      let cwd = targetBase;
      if (file && file.trim().length > 0) {
        scriptPath = resolveInsideBase(targetBase, file, UNSAFE);
        if (!existsSync(scriptPath)) {
          return { success: false, error: `الملف غير موجود: ${file}` };
        }
        cwd = dirname(scriptPath);
      } else if (code && code.trim().length > 0) {
        const scriptsDir = join(targetBase, "scripts");
        await ensureDirectory(scriptsDir);
        const ext = language === "python" ? ".py" : ".js";
        scriptPath = join(scriptsDir, `run_tmp_${Date.now()}${ext}`);
        await writeFile(scriptPath, code, "utf-8");
        cwd = scriptsDir;
      } else {
        return { success: false, error: "يجب توفير إما code أو file" };
      }
      const cmd = language === "python" ? "python" : "node";
      const res = await runCommand({
        cmd,
        args: scriptPath ? [scriptPath, ...argv] : argv,
        cwd,
        timeoutMs,
        stageLabel: "runCode"
      });
      return { success: !!res.success, code: res.code, stdout: res.stdout, stderr: res.stderr, cwd, script: scriptPath, language };
    }
  }));

  /* ----------------------------- arabicCommand ------------------------ */
  tools.push(tool({
    name: "arabicorenglishCommand",
    description: "نفّذ أوامر عربية وانجليزية طبيعية للملفات (احفظ/انسخ/اقرأ/احذف/اعرض/show/read/open/delete/move). قبول مسارات بين اقتباسات وبمسافات؛ عند الفشل مرّر النص للتحليل الإدراكي.",
    parameters: { instruction: z.string().min(1), content: z.string().optional() },
    implementation: async ({ instruction, content }) => {
      const s = instruction.trim();
      const normalizeInput = (t: string) => t
        .replace(/[“”]/g, '"')
        .replace(/\u00A0/g, ' ')
        .trim();
      const input = normalizeInput(s);

      const saveRe = /(احفظ|اكتب|انشئ|create |save |new)\s+(?:ملف\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(?:بمحتوى|بمحتوى:|بمحتوى\\:)\s+(?:"([\s\S]+)"|'([\s\S]+)'|([\s\S]+)))?$/i;
      const copyRe = /(انسخ|انقل|move | copy)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+(?:إلى|الى|ل|إلي)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;
      const readRe = /(اقرأ|افتح| read| open)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;
      const delRe  = /(احذف|امسح|احرق| delete| burn)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;
      const listRe = /(اعرض|استعرض|قائمة|الملفات|list |show| view)(?:\s+(?:في|داخل)\s+(?:"([^"]+)"|'([^']+)'|(\S+)))?/i;

      const mSave = input.match(saveRe);
      if (mSave) {
        const file = mSave[2] || mSave[3] || mSave[4];
        const body = mSave[5] || mSave[6] || mSave[7] || content || '';
        if (!file) return { success: false, error: "لم يتم تحديد اسم الملف." };
        const filePath = resolveInsideBase(targetBase, file, UNSAFE);
        await ensureDirectory(join(filePath, ".."));
        await writeFile(filePath, body, "utf-8");
        return { success: true, message: `تم حفظ الملف ${file}` };
      }

      const mCopy = input.match(copyRe);
      if (mCopy) {
        const from = mCopy[2] || mCopy[3] || mCopy[4];
        const to   = mCopy[5] || mCopy[6] || mCopy[7];
        const fromPath = resolveInsideBase(targetBase, from, UNSAFE);
        const toPath   = resolveInsideBase(targetBase, to, UNSAFE);
        if (!existsSync(fromPath)) return { success: false, error: `الملف ${from} غير موجود.` };
        await ensureDirectory(join(toPath, ".."));
        await cp(fromPath, toPath, { force: true });
        return { success: true, message: `تم نسخ ${from} إلى ${to}` };
      }

      const mRead = input.match(readRe);
      if (mRead) {
        const file = mRead[2] || mRead[3] || mRead[4];
        const filePath = resolveInsideBase(targetBase, file, UNSAFE);
        if (!existsSync(filePath)) return { success: false, error: `الملف ${file} غير موجود.` };
        const data = await readFile(filePath, "utf-8");
        return { success: true, content: data, message: `تمت قراءة ${file}` };
      }

      const mDel = input.match(delRe);
      if (mDel) {
        const file = mDel[2] || mDel[3] || mDel[4];
        const filePath = resolveInsideBase(targetBase, file, UNSAFE);
        if (!existsSync(filePath)) return { success: false, error: `الملف ${file} غير موجود.` };
        await rm(filePath, { force: true });
        return { success: true, message: `تم حذف ${file}` };
      }

      const mList = input.match(listRe);
      if (mList) {
        const folder = mList[2] || mList[3] || mList[4] || ".";
        const folderPath = resolveInsideBase(targetBase, folder, UNSAFE);
        if (!existsSync(folderPath)) return { success: false, error: `المجلد ${folder} غير موجود.` };
        const { readdir, stat } = await import("fs/promises");
        const entries = await readdir(folderPath, { withFileTypes: true });
        const items = await Promise.all(entries.map(async (entry) => {
          const full = join(folderPath, entry.name);
          const st = await stat(full);
          return {
            name: entry.name,
            type: entry.isDirectory() ? "مجلد" : "ملف",
            size: entry.isDirectory() ? "-" : `${(st.size/1024).toFixed(2)} KB`,
            modified: st.mtime.toISOString()
          };
        }));
        return { success: true, folder, items };
      }

      // تمرير إدراكي عند فشل المطابقة
      return { success: true, message: "تم تمرير النص للتحليل الإدراكي.", raw: instruction };
    }
  }));

  /* ----------------------------- dynamicTool -------------------------- */
  tools.push(tool({
    name: "dynamicTool",
    description: text`أنشئ/شغّل أداة ديناميكية وسجّلها في dynamic_tools_log.xlsx تلقائيًا.`,
    parameters: {
      tool_name: z.string().min(1),
      language: z.enum(["python","javascript"]).default("javascript"),
      code: z.string().min(1),
      purpose: z.string().optional(),
      functions: z.array(z.string()).optional(),
      args: z.array(z.string()).optional(),
      run: z.boolean().default(true)
    },
    implementation: async ({ tool_name, language, code, purpose, functions, args, run }) => {
      const dynDir = join(targetBase, "dynamic_tools");
      await ensureDirectory(dynDir);
      const ext = language === "python" ? ".py" : ".js";
      const codePath = join(dynDir, `${tool_name}${ext}`);
      await writeFile(codePath, code, "utf-8");

      let stdout = "", stderr = "", codeExit = 0; let success = true;
      if (run) {
        const cmd = language === "python" ? "python" : "node";
        const res = await runCommand({ cmd, args: [codePath, ...(Array.isArray(args) ? args : [])], cwd: dynDir, timeoutMs: 3600000, stageLabel: `dynamicTool:${tool_name}` });
        stdout = res.stdout; stderr = res.stderr; codeExit = res.code; success = res.success;
      }

      const wb = new ExcelJS.Workbook();
      const filePath = join(targetBase, "dynamic_tools_log.xlsx");
      if (existsSync(filePath)) await wb.xlsx.readFile(filePath);
      let ws = wb.getWorksheet("Tools") || wb.addWorksheet("Tools");
      if (ws.rowCount === 0) {
        ws.addRow(["tool_name","language","purpose","functions","path","timestamp","success","exit_code","stdout","stderr"]);
      }
      ws.addRow([
        tool_name,
        language,
        purpose || "",
        Array.isArray(functions) ? functions.join(",") : "",
        codePath,
        new Date().toISOString(),
        success ? "1" : "0",
        codeExit,
        stdout.slice(0, 2000),
        stderr.slice(0, 2000)
      ]);
      await wb.xlsx.writeFile(filePath);

      return { success: true, message: "تم إنشاء الأداة الديناميكية.", path: codePath, runSuccess: success, log: filePath, stdout, stderr };
    }
  }));

  /* ----------------------------- runDynamicTool ----------------------- */
  tools.push(tool({
    name: "runDynamicTool",
    description: text`شغّل أداة ديناميكية محفوظة مسبقًا من dynamic_tools.`,
    parameters: { tool_name: z.string().min(1), language: z.enum(["python","javascript"]).default("javascript"), args: z.array(z.string()).optional(), timeoutMs: z.number().int().min(0).max(3600000).optional() },
    implementation: async ({ tool_name, language, args, timeoutMs }) => {
      const dynDir = join(targetBase, "dynamic_tools");
      const ext = language === "python" ? ".py" : ".js";
      const codePath = join(dynDir, `${tool_name}${ext}`);
      if (!existsSync(codePath)) return { success: false, error: `لم يتم العثور على الأداة: ${tool_name}` };
      const cmd = language === "python" ? "python" : "node";
      const res = await runCommand({ cmd, args: [codePath, ...(Array.isArray(args) ? args : [])], cwd: dynDir, timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 3600000, stageLabel: `runDynamicTool:${tool_name}` });
      return { success: !!res.success, code: res.code, stdout: res.stdout, stderr: res.stderr, path: codePath };
    }
  }));

  return tools;
}

/* --------------- Helper Functions (not registered as tools) --------------- */
function resolveInsideBase(baseDir: string, rel: string, _unsafe = true) {
  // تمرير مطلق: أي مسار مطلق أو نسبي مسموح، مع تطبيع المسار فقط
  const isAbs = /^([A-Za-z]:)?[\\\/]/.test(rel);
  return normalize(isAbs ? rel : join(baseDir, rel || ""));
}