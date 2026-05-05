







const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const modelsDir = 'public/models';
const files = fs.readdirSync(modelsDir);

files.forEach(file => {
  if (file.endsWith('.glb')) {
    const filePath = path.join(modelsDir, file);

    console.log(`Resizing textures for ${file}...`);
    try {
      // Resize to 512x512
      execSync(`npx @gltf-transform/cli resize --width 512 --height 512 "${filePath}" "${filePath}"`);
      console.log(`Successfully resized ${file}`);
    } catch (err) {
      console.error(`Failed to resize ${file}:`, err.message);
    }
  }
});
