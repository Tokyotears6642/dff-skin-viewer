const fs = require('node:fs');
const path = require('node:path');

const templatePath = path.resolve(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'portable.nsi');
const marker = '!ifdef MUI_ICON\n  Icon "${MUI_ICON}"\n!endif';

if (!fs.existsSync(templatePath)) {
  throw new Error(`No se encontro el template portable: ${templatePath}`);
}

const content = fs.readFileSync(templatePath, 'utf8');
if (!content.includes(marker)) {
  const nextContent = content.replace('!include "extractAppPackage.nsh"\n', `!include "extractAppPackage.nsh"\n\n${marker}\n`);
  fs.writeFileSync(templatePath, nextContent);
  console.log('Template portable NSIS actualizado con icono custom.');
} else {
  console.log('Template portable NSIS ya tenia icono custom.');
}
