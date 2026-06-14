// server.js - DeepEditor
import express from 'express';
import cors from 'cors';
import { LMStudioClient } from '@lmstudio/sdk';

const app = express();
const PORT = 3456;

app.use(cors());
app.use(express.json());

const client = new LMStudioClient();

let registeredTools = [];

async function fetchRegisteredTools() {
    try {
        const toolNames = [
            "writeFile", "readFile", "renameFile", "deleteFile", "copyFile",
            "listDirectoryStructure", "createFolder", "deleteFolder", "renameFolder", "moveFolder",
            "getCurrentTime", "getCurrentDate", "markAwareness",
            "saveContextMemory", "loadContextMemory", "readExcelSheet", "appendExcelRow",
            "runCode", "arabicorenglishCommand", "dynamicTool", "runDynamicTool"
        ];
        registeredTools = toolNames.map(name => ({
            type: "function",
            function: {
                name: name,
                description: `Tool from DeepEditor Plugin (Bidobyte)`,
                parameters: { type: "object", properties: {} }
            }
        }));
        console.log(`✅ تم تحميل ${registeredTools.length} أداة مسجلة.`);
    } catch (error) {
        console.error("❌ فشل في جلب الأدوات:", error);
    }
}

app.post('/api/chat', async (req, res) => {
    const { userMessage, systemPrompt = "أنت نور حكيم، مساعد ذكي ومهندس خبير. رد بالعربية. استخدم الأدوات المتاحة عند الحاجة." } = req.body;
    
    try {
        const model = await client.llm.model();
        
        const lmStudioUrl = 'http://localhost:1234/v1/chat/completions';
        
        const response = await fetch(lmStudioUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model.identifier,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                tools: registeredTools,
                tool_choice: "auto",
                stream: true,
                max_tokens: 2000
            })
        });
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.choices?.[0]?.delta?.content) {
                            res.write(`data: ${JSON.stringify({ content: data.choices[0].delta.content })}\n\n`);
                        }
                        if (data.choices?.[0]?.delta?.tool_calls) {
                            console.log("🔧 النموذج يطلب أداة:", data.choices[0].delta.tool_calls);
                        }
                    } catch (e) { /* تجاهل */ }
                }
            }
        }
        
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        
    } catch (error) {
        console.error("❌ خطأ في /api/chat:", error);
        res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
        res.end();
    }
});

app.listen(PORT, async () => {
    await fetchRegisteredTools();
    console.log(`\n╔════════════════════════════════════════════════╗`);
    console.log(`║   🐺 DeepEditor - الخادم الوسيط              ║`);
    console.log(`║   يعمل على http://localhost:${PORT}            ║`);
    console.log(`║   عدد الأدوات المسجلة: ${registeredTools.length}             ║`);
    console.log(`╚════════════════════════════════════════════════╝\n`);
});