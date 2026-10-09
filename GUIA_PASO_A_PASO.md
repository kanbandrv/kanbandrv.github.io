# Tablero Kanban de Obra — Guía paso a paso (sin programar)

Con esto tendrá: **una app web instalable** (iPhone, Android y Windows) y **un instalador .exe para Windows**, todo con los mismos datos sincronizados.

| Pieza | Para qué sirve | Costo |
|---|---|---|
| **Supabase** | Guarda los datos y controla quién entra | Gratis |
| **GitHub** | Guarda el código, publica la app web y fabrica el .exe en la nube | Gratis |

Tiempo estimado: 45–60 minutos la primera vez. Cada parte es independiente: si se cansa, puede parar al final de cualquier parte.

---
## PARTE A — Crear la base de datos (Supabase) · 15 min

1. Entre a **https://supabase.com** → **Start your project** → inicie sesión (con Google o correo).
2. **New project**:
   - Name: `kanban-obra`
   - Database Password: invente una y **guárdela** (no la usará a diario).
   - Region: la más cercana (por ejemplo *East US* o *South America (São Paulo)*).
   - **Create new project** y espere 1–2 minutos.
3. **Desactive la confirmación por correo** (para que crear cuentas sea simple):
   menú izquierdo **Authentication** → **Sign In / Providers** → **Email** → apague **Confirm email** → **Save**.
4. **Prepare la base de datos**:
   - Abra el archivo `sql/1_preparar_base_de_datos.sql` con el Bloc de notas.
   - En la **última línea** cambie `PEGUE_AQUI_SU_CORREO@ejemplo.com` por **su correo** (el que usará para entrar).
   - Copie TODO el texto.
   - En Supabase: menú izquierdo **SQL Editor** → **New query** → pegue → **Run**.
   - Debe decir *Success. No rows returned*.
5. **Copie sus dos datos de conexión**: menú izquierdo **Project Settings** (engranaje) → **API Keys** (o **API**):
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - **anon public key** (texto largo que empieza por `eyJ`). *Es la clave pública; no confunda con la `service_role`, esa NO se usa.*
   Déjelos a mano en el Bloc de notas.

## PARTE B — Subir el proyecto a GitHub · 15 min

1. Entre a **https://github.com** → **Sign up** (o inicie sesión).
2. Arriba a la derecha **+** → **New repository**:
   - Repository name: `kanban-obra`
   - Marque **Public** (hace falta para publicar la app web gratis; ver nota de seguridad al final).
   - **Create repository**.
3. En la página nueva, haga clic en **uploading an existing file**.
4. Descomprima `kanban-obra.zip` en su computador. Abra la carpeta `kanban-obra`, seleccione **todo su contenido** (las carpetas `www`, `sql`, `build`, `.github` y los archivos `main.js`, `package.json`, `.gitignore`, esta guía) y **arrástrelo** a la ventana de GitHub.
   - Si no ve la carpeta `.github` (está oculta): en el Explorador de Windows → pestaña **Vista** → marque **Elementos ocultos**.
5. Abajo: **Commit changes** (botón verde).
6. **Ponga sus datos de conexión**: en GitHub abra `www` → `config.js` → ícono del lápiz (Edit). Pegue entre las comillas su **Project URL** y su **anon public key**:
   ```js
   window.KANBAN_CONFIG = {
     SUPABASE_URL: "https://abcdxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJ..."
   };
   ```
   **Commit changes**.
   *(Alternativa: dejar `config.js` vacío; la app pedirá los datos la primera vez en cada dispositivo.)*

## PARTE C — Publicar la app web (celular y navegador) · 5 min

1. En su repositorio: **Settings** → menú izquierdo **Pages**.
2. En **Build and deployment → Source** elija **GitHub Actions**.
3. Vaya a la pestaña **Actions** → a la izquierda **Publicar app web** → **Run workflow** → **Run workflow**.
4. Espere ~1 minuto a que salga ✅ verde. Su dirección será:
   **`https://SU-USUARIO.github.io/kanban-obra/`**
   (aparece también en Settings → Pages).
5. Ábrala: verá la pantalla de acceso. Toque **Soy nuevo: crear cuenta**, escriba **el mismo correo** que puso en el SQL y una contraseña de 8+ caracteres. Ya es administrador.

## PARTE D — Generar el instalador .exe de Windows · 10 min

1. En su repositorio: pestaña **Actions** → a la izquierda **Crear instalador .exe de Windows** → **Run workflow** → **Run workflow**.
2. Espere 4–8 minutos hasta el ✅ verde. Haga clic en esa ejecución.
3. Al final de la página, en **Artifacts**, descargue **instalador-windows** (viene en un .zip).
4. Descomprima y haga doble clic en `Tablero-Kanban-Obra-Instalador-1.0.0.exe`.
   - Windows puede mostrar **«Windows protegió su PC»** porque el programa no tiene firma digital (cuesta dinero). Clic en **Más información → Ejecutar de todos modos**. Es normal.
5. Se crea un acceso directo en el escritorio. Entra con el mismo correo y contraseña.

## PARTE E — Instalar en celulares y tabletas · 2 min por equipo

- **iPhone / iPad** (use **Safari**, no Chrome): abra la dirección de la Parte C → botón **Compartir** (cuadrado con flecha) → **Añadir a pantalla de inicio** → **Añadir**.
- **Android** (Chrome): abra la dirección → menú ⋮ → **Instalar app** (o **Añadir a pantalla de inicio**).
- **Windows sin instalar nada**: en Chrome o Edge abra la dirección → ícono de instalar en la barra de direcciones.

## PARTE F — Dar acceso al equipo

1. Entre como administrador → pestaña **Equipo y ajustes** → tarjeta **Accesos a la herramienta**.
2. Escriba el correo de cada persona, su nombre y el permiso (**Editor**, **Lector** o **Administrador**) → **Autorizar**.
3. Cada persona abre la app, toca **Soy nuevo: crear cuenta** con **ese mismo correo**, y entra.
   Si alguien olvida su contraseña: en Supabase → **Authentication → Users** → los tres puntos del usuario → **Send password recovery** o elimine el usuario para que se registre de nuevo.

## PARTE G — Pasar los datos de la versión actual (opcional)

1. En la herramienta de Claude: **Equipo y ajustes → Descargar respaldo completo (.json)**.
2. En la app nueva (como Editor/Administrador): **Equipo y ajustes → Restaurar desde respaldo** → elija el archivo → **Restaurar**.

## Después de cada comité
Descargue el **respaldo completo (.json)** y guárdelo en la carpeta compartida del proyecto. Con eso el historial queda a salvo aunque algo falle.

---
## Qué hacer cuando algo falla
| Síntoma | Qué hacer |
|---|---|
| «La base de datos aún no está preparada» | No se ejecutó el SQL (Parte A paso 4). |
| «El correo … todavía no tiene acceso» | El administrador debe autorizar ese correo (Parte F), escrito igual. |
| Pide «Project URL» al abrir | `config.js` está vacío (Parte B paso 6) o pegue los datos ahí mismo. |
| No sale el botón «Run workflow» | Confirme que subió la carpeta `.github` (Parte B paso 4). |
| La app publicada no cambia tras editar | Actions → **Publicar app web** → Run workflow; en el celular cierre y abra la app. |
| El workflow del .exe sale en rojo ❌ | Haga clic en él, copie el mensaje de error rojo y envíemelo. |

## Cosas importantes que debe saber
- **Seguridad:** el código de la app es público (no tiene datos). **Los datos solo se ven con correo y contraseña autorizados.** La «anon key» es pública por diseño; nunca ponga la `service_role` en ningún archivo.
- **Supabase gratis se pausa si pasan 7 días sin uso.** Si ocurre, entre a supabase.com y toque **Restore project** (no pierde datos). Con uso semanal no sucede.
- **iPhone:** no existe «.exe» ni se puede instalar fuera de la App Store sin pagar; la app instalable desde Safari es la vía gratuita y funciona como una app normal.
- El .exe de Windows y la app web son **la misma aplicación y los mismos datos**.
