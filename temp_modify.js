const fs = require('fs');

const filePath = 'fontend/src/app/machine_working/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Find the line "const timestamp = Date.now();" and insert code before the next line
const searchText = '            const timestamp = Date.now();';
const insertCode = `
            // ✅ 1. Fetch Models List First
            const resModels = await axios.get(\`\${config.apiServer}/api/oee/getModelsByDate\`, {
                params: { machine_ name: machine, date: date, t: timestamp }
            });
            const models = resModels.data.results.map((m: any) => m.model_name);
            setModelsList(models);

            // Set default selected model if not already set
            let targetModel = selectedModel;
            if (!selectedModel && models.length > 0) {
                targetModel = models[0];
                setSelectedModel(targetModel);
            }

            // ✅ 2. Prepare model parameter
            const modelParam = targetModel ? \`&model_name=\${targetModel}\` : '';
`;

const lines = content.split('\n');
const newLines = [];
for (let i = 0; i < lines.length; i++) {
    newLines.push(lines[i]);
    if (lines[i].includes('const timestamp = Date.now();') && lines[i].includes('fetch')) {
        // Insert the new code after this line
        newLines.push(insertCode);
    }
}

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('✅ Successfully modified file');
