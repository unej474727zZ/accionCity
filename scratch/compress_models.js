const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const modelsDir = 'public/models';
const files = fs.readdirSync(modelsDir);

files.forEach(file => {
  if (file.endsWith('.glb')) {
    const filePath = path.join(modelsDir, file);
    const tempPath = path.join(modelsDir, 'temp_' + file);
    
    console.log(`Compressing ${file}...`);
    try {
      execSync(`npx gltf-pipeline -i "${filePath}" -o "${tempPath}" -d`);
      
      const oldSize = fs.statSync(filePath).size;
      const newSize = fs.statSync(tempPath).size;
      
      if (newSize < oldSize) {
        console.log(`Success: ${file} reduced from ${Math.round(oldSize/1024)}KB to ${Math.round(newSize/1024)}KB`);
        fs.unlinkSync(filePath);
        fs.renameSync(tempPath, filePath);
      } else {
        console.log(`No reduction for ${file}, keeping original.`);
        fs.unlinkSync(tempPath);
      }
    } catch (err) {
      console.error(`Failed to compress ${file}:`, err.message);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
});
