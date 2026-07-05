# Skin Viewer

Visualizador y editor para skins RenderWare de GTA/SAMP. Abre una carpeta con archivos `.dff` y `.txd`, muestra el modelo en 3D, permite inspeccionar materiales/texturas y guardar cambios dentro del TXD con backup automatico.

## Funciones

- Carga modelos `.dff` con texturas `.txd` emparejadas por nombre.
- Camara orbital con mouse y zoom con rueda.
- Inspector con peso de DFF/TXD, geometria, materiales, texturas e IFP.
- Mostrar u ocultar materiales.
- Reemplazar texturas desde PNG/JPG.
- Guardar el TXD actualizado con backup automatico.
- Editor de logo sobre un material con preview en tiempo real.
- Favoritos para copiar DFF/TXD a una carpeta `favorites`.
- Notificaciones internas para guardados, backups y errores.
- Auto-update desde GitHub Releases en la version instalable.

## Requisitos

- Node.js 20 o superior.
- Windows para generar los `.exe`.

## Instalar dependencias

```bash
npm install
```

## Ejecutar en desarrollo

```bash
npm run dev
```

## Buildear

Build web:

```bash
npm run build
```

Build Windows completo:

```bash
npm run dist:win
```

El build genera los archivos en `release/`:

- `Skin-Viewer-by-Tokyo-tears-Setup-<version>-x64.exe`: instalador con auto-update.
- `Skin-Viewer-by-Tokyo-tears-Portable-<version>-x64.exe`: portable sin auto-update.
- `latest.yml` y `.blockmap`: metadata usada por el auto-update.

## Scripts

- `npm run dev`: abre Vite + Electron.
- `npm run lint`: corre ESLint.
- `npm run build`: genera `dist/`.
- `npm run dist:win`: genera instalador y portable.
- `npm run dist:win:portable`: genera solo portable.

## Notas de seguridad

Al guardar texturas, la app crea un backup del TXD original antes de reescribirlo. Igual conviene mantener una copia de tus skins importantes antes de editarlas.
