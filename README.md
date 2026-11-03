# Mundo Virtual (tipo Second Life)

Mundo 3D en el navegador donde varios usuarios construyen objetos y se ven entre sí. Three.js + Node.js + WebSockets.

## Cómo ejecutarlo

1. Instala Node.js 18 o superior.
2. En esta carpeta: `npm install` y luego `npm start`.
3. Abre http://localhost:3001. Para jugar entre varias personas de la misma red, usa la IP del equipo, por ejemplo http://192.168.1.20:3001.

Los archivos subidos que ya nadie usa se borran solos de `uploads/` al arrancar y cada 6 horas, si llevan más de 7 días sin usarse (se cambia con la variable `GC_DAYS`; por ejemplo `GC_DAYS=30 npm start`, o `GC_DAYS=0` para borrarlos en cuanto dejen de usarse).

El mundo se guarda en `world.json` (se crea solo). Para empezar de cero, detén el servidor y borra ese archivo. Guarda todos los mundos.

## Si ves la pantalla negra

- Abre siempre http://localhost:3001 con el servidor en marcha (`npm start`); no abras `index.html` con doble clic.
- Three.js ya va incluido en `three.min.js` (v5.1: antes se descargaba de un CDN y, sin internet o con bloqueadores, la escena no arrancaba).
- Si falla algo, ahora aparece un mensaje en pantalla con la causa (por ejemplo, WebGL desactivado).

## Estructura

- `index.html` (raíz): **el cliente** (ventanas flotantes, editor, avatar y multijugador en un solo archivo). Desde v6.53 ya no hay carpeta `public/` ni portada: la raíz del proyecto es la raíz de la web
- `three.min.js`, `TransformControls.js`, `GLTFLoader.js` y `SkeletonUtils.js`: Three.js r128 y sus utilidades, en local
- `models/avatar.glb`: modelo de avatar con esqueleto y animaciones
- `tools/test_client.py`: prueba de extremo a extremo en Chromium (v6.38; ampliada en v6.39, v6.45 a v6.52)
- `tools/test_vuelo.js`: prueba del servidor real para la altura del avatar al volar, con dos jugadores (v6.44)
- `tools/test_facetex.js`: prueba del servidor real para textura, opacidad, transformación de textura, brillo y especular por cara, con datos falsos y limpieza de archivos (v6.39 a v6.43)
- `csg.js` y `tools/test_csg.js`: unión, resta e intersección de sólidos (v6.36; conectado al editor y al servidor en v6.37)
- `prim.js` y `tools/test_prim.js`: generador de prims con corte, hueco, torsión y caras separadas (v6.33; conectado al editor en v6.34)
- `Dockerfile`, `.dockerignore` y `tools/test_deploy.js`: publicar y probar el servidor (v6.32)
- `server.js`: servidor HTTP + WebSocket, validación y guardado del mundo
- `tools/benchmark.py`: mide el rendimiento del cliente con muchos objetos (ver v6.30 y v6.31)
- `tools/test_merge.py`: prueba automática de la fusión de objetos lejanos (v6.31)

## Estructura y publicación en internet (v6.53)

- **`index.html` está en la raíz** y es el cliente real: `/` lo sirve directamente. Los antiguos `public/*` (`three.min.js`, `GLTFLoader.js`, `SkeletonUtils.js`, `TransformControls.js`, `csg.js`, `prim.js` y `models/avatar.glb`) también viven en la raíz.
- **El servidor solo sirve una lista cerrada de archivos** (`PUBLIC_FILES` en `server.js`): esos siete archivos y `models/*.glb`, más `/uploads/<hash>` y `/healthz`. Cualquier otra ruta (`/server.js`, `/world.json`, `/package.json`, `/README.md`, `/tools/…`, `/node_modules/…`, intentos con `..`) responde 404. Si añades un archivo que el cliente necesite, hay que añadirlo a esa lista **y** al `COPY` del `Dockerfile` (la prueba `test_deploy.js` avisa si falta).
- **Node incluido en la imagen**: el `Dockerfile` parte de `node:22-alpine`, así que el servidor donde lo subas solo necesita **Docker**; no hay que instalar Node. Para plataformas sin Docker (Render, Railway, Heroku, un VPS…): `package.json` declara `engines.node >= 18`, `scripts.start` es `node server.js`, y `.nvmrc` / `.node-version` piden Node 22; esas plataformas instalan Node solas con `npm install` y `npm start`. Escucha en `process.env.PORT`.
- **Datos persistentes**: monta un volumen en `/data` (`DATA_DIR`) o perderás `world.json` y `uploads/` al reiniciar. Ver más abajo (v6.32) las variables `TRUST_PROXY`, `ALLOWED_ORIGINS`, etc.
- **Qué NO se probó**: `docker build` (no había Docker disponible aquí; sí se probó `npm ci --omit=dev` y el arranque con los mismos archivos que copia el Dockerfile) ni un despliegue real en una plataforma. `world.json` de este paquete es el que traías: el `.dockerignore` lo deja fuera de la imagen para que no se publique tu mundo de pruebas.
- **Pruebas** (pasan): `test_deploy.js` **37** (+23: `/` sirve el cliente, los 8 archivos públicos se sirven, 14 rutas peligrosas dan 404/400, y el `Dockerfile` trae Node y copia todo); las demás sin cambios (`test_vuelo.js` 33, `test_client.py` 75, `test_csg.js` 22, `test_prim.js` 25, `test_facetex.js`). Las rutas de las pruebas se actualizaron (`tools/*.py` y `*.js` ya no buscan `public/`). Nota: en las secciones históricas de más abajo aún puede aparecer `public/` como se llamaba entonces.

## Estado actual (v6.53): el servidor valida la altura en parcelas «sin vuelo»

- [x] **Cierra el hueco de v6.49**: antes, un cliente modificado que mandara el estado 0 o 3 mientras volaba dentro de una parcela «solo su dueño e invitados» no se detectaba. Ahora, para quien **no tiene permiso** (no es dueño, invitado, creador del mundo ni administrador), el servidor rechaza **cualquier** posición dentro de esa parcela que esté por encima de lo que permiten el suelo, los objetos y un salto, sea cual sea el estado declarado. Lo rechazado no se difunde y el jugador vuelve a su última posición aceptada (con su altura, ya no siempre y = 0). Versión del paquete: 6.53.0.
- [x] **Cómo se calcula**: `standCeil(W, x, z)` = la parte más alta (centro + radio conservador `itRadius`) de los objetos cuyo círculo cubre ese punto (+1 m de margen), más 1,6 m (un salto del cliente llega a 1 m: velocidad 6, gravedad 18, más margen). Por debajo de 1,6 m ni se calcula (no cuesta nada en el caso normal). Subirse a una torre o a un tejado sigue siendo legítimo.
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` **33** (+7: 20 m con estado 0 y con estado 3 se rechazan, un salto de 1 m se difunde, una torre de 10 m puesta por el dueño: subido encima (10,5 m) vale y a 60 m no, fuera de la parcela no se restringe); `test_client.py` 75, `test_facetex.js`, `test_csg.js` 22, `test_prim.js` 25 y `test_deploy.js` sin cambios.
- **Límites**: es una cota **conservadora**, no exacta: el servidor no conoce la forma real de los objetos (usa una esfera que los envuelve), así que alguien podría volar «pegado» por encima de un objeto grande o hueco hasta unos metros; un grupo enorme da un techo alto en toda su zona. Solo protege las parcelas con «solo yo e invitados» (el terreno libre y las parcelas «cualquiera» no se restringen, hasta los 150 m de siempre). Un jugador que se teletransporte desde «lugares guardados» a una altura mayor al techo dentro de una parcela protegida será devuelto. Un cliente modificado aún puede moverse por el suelo a cualquier velocidad (no se valida la velocidad).
- **Qué NO se probó**: con jugadores reales en navegador (solo mensajes al servidor), con objetos girados o modelos `.glb` muy grandes, ni el coste con 5000 objetos y muchos jugadores moviéndose a la vez dentro de una parcela protegida (el recorrido es lineal en el número de objetos, pero solo se hace si se está por encima de 1,6 m).
- **Pendiente**: validar la velocidad de movimiento; tamaño ajustable del joystick y probar en celular real; inclinación según la velocidad.

### Detalle: invitados para volar y construir (v6.52)

- [x] **Invitados también construyen**: en una parcela con «construir: solo yo», los invitados de la lista (v6.52) pueden **colocar objetos** además de volar. El servidor (`canPlace`) los deja pasar y el aviso a los demás dice «solo su dueño e invitados pueden construir ahí». La lista de parcelas y el texto de «Estás en…» muestran «su dueño e invitados» cuando hay invitados. Es una sola lista para ambas cosas (no hay invitados «solo volar» o «solo construir»).
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` **26** (+3: sin invitación se rechaza con aviso, con invitación se construye, al quitarla se vuelve a rechazar).
- **Límites**: el invitado solo puede construir **hasta el máximo de objetos** de la parcela; quien creó el mundo y el administrador siguen sin poder construir en «solo yo» (como antes); solo se invita a quien está conectado.

### Detalle: lista de invitados para volar

- [x] **Parcelas → «Volar: solo yo e invitados»** (antes «solo yo»): el dueño de la parcela (o quien creó el mundo, o el administrador) ve ahora debajo del selector una **lista de invitados** con ✕ para quitarlos y un selector con los **jugadores presentes** en el mundo + botón **Invitar**. Los invitados pueden volar en esa parcela aunque el permiso sea «solo yo e invitados». Máximo 10 invitados por parcela. Se guarda con la parcela en `world.json` (campo `guests: [{uid, name}]`; las parcelas anteriores no lo tienen y funcionan igual). Versión del paquete: 6.52.0.
- [x] **Servidor**: mensaje nuevo `pguest` con `add` (id del jugador presente en el mundo) o `del` (uid del invitado); solo lo aceptan el dueño de la parcela, quien creó el mundo o el administrador. No duplica invitados, avisa si el jugador ya no está o si se llegó al máximo. La comprobación de v6.49 (no difundir «volando» sin permiso) ahora también deja pasar a los invitados. El cliente (`noFlyHere`) hace lo mismo y el aviso dice «solo su dueño e invitados».
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` **23** (+8: un no-dueño no puede invitar, el dueño invita, no se duplica, el invitado vuela sin rebote, al quitarlo vuelve a rebotar, jugador inexistente da aviso); `python3 tools/test_client.py` **75** (+3: el aviso menciona a los invitados, con invitación vuela, no se corta el vuelo dentro de la parcela).
- **Qué NO se probó**: la lista de invitados y el botón **Invitar** hechos clic a clic en un navegador con dos jugadores reales (se probó por mensajes al servidor y con la parcela modificada por código en el cliente); la lista con nombres muy largos o en pantallas estrechas.
- **Límites**: sigue sin ser seguridad fuerte (ver v6.49: el servidor solo ve lo que el cliente declara); los invitados se identifican por el código del navegador (uid), así que si alguien borra sus datos pierde la invitación; solo se puede invitar a quien está conectado en ese momento; la invitación solo afecta a volar (no a construir).
- **Pendiente**: validar alturas en el servidor; tamaño ajustable del joystick y probar en celular real; inclinación según la velocidad.

## Estado anterior (v6.51): joystick analógico (opcional)

- [x] **Ajustes → «Caminar con»**: selector **Cruz de 4 flechas** (como en v6.45, sigue siendo lo predeterminado) o **Joystick**. Con el joystick, a la izquierda aparece un círculo de 150 px con una perilla: **empujas hacia donde quieres ir y la velocidad depende de cuánto lo empujes** (zona muerta del 15 %; velocidad completa a partir del 85 % del recorrido). Funciona igual caminando que volando (los botones de la derecha no cambian). Se recuerda en el navegador (`mv_tpadmode`). Solo cliente; el servidor no cambia. Versión del paquete: 6.51.0.
- [x] **Cómo funciona**: el joystick escribe un vector (`joy`) que `step()` usa en lugar de las teclas cuando pasa la zona muerta, y escala la velocidad (`jsc`). La dirección sigue siendo relativa a la cámara, como con las teclas.
- [x] **Pruebas** (pasan): `python3 tools/test_client.py` **72** (+5, en contexto táctil: al elegir joystick se oculta la cruz y aparece el círculo; empujado a fondo mueve al avatar; a medio empujar recorre entre el 30 % y el 70 % de la distancia a fondo; casi en el centro no se mueve; se puede volver a la cruz); `test_vuelo.js` 15 y las demás sin cambios.
- **Qué NO se probó**: un celular real (solo eventos de puntero lanzados por código, un dedo a la vez); usar el joystick y los botones de vuelo con **dos dedos a la vez** de verdad; el tamaño de 150 px en pantallas pequeñas o en horizontal; que el círculo no tape el dock o ventanas flotantes; que la velocidad «se sienta» bien (la curva es lineal y no se afinó).
- **Límites**: el joystick es fijo (no aparece donde tocas); no hay tamaño ajustable; no distingue la inclinación de la postura al volar según la velocidad (la inclinación sigue siendo fija); correr (») sigue siendo un botón aparte.
- **Pendiente**: probar en celular real y afinar tamaño y curva; tamaño ajustable; lista de invitados para volar; validar alturas en el servidor; inclinación según la velocidad.

## Estado anterior (v6.50): ocultar o mostrar los botones en pantalla

- [x] **Ajustes → «Botones en pantalla para caminar y volar»**: casilla que **oculta** la cruz y los botones de vuelo en el celular (por ejemplo, si usas teclado o quieres ver mejor el mundo) o los **muestra con ratón** (por ejemplo, en una laptop con pantalla táctil que no los activó). Por defecto sigue igual que en v6.45 (visibles en pantallas táctiles, ocultos con ratón). Se **recuerda en el navegador** (`localStorage`, clave `mv_tpad`); al ocultarlos se sueltan las teclas que tuvieran pulsadas. Solo cliente. Versión del paquete: 6.50.0.
- [x] **Pruebas** (pasan): `python3 tools/test_client.py` **67** (+5: la casilla viene marcada en táctil, al desmarcarla se ocultan, se recuerda tras recargar, al volver a marcarla reaparecen, con ratón también se pueden mostrar); `test_vuelo.js` 15 y las demás sin cambios.
- **Qué NO se probó**: un celular real; el aspecto de la casilla en la ventana *Ajustes* en pantallas estrechas; navegadores con `localStorage` bloqueado (el código lo tolera con `try/catch`, pero no se probó que la casilla funcione sin recordar).
- **Límites**: el joystick analógico llegó en v6.51; los botones no se pueden mover ni cambiar de tamaño.
- **Pendiente**: joystick analógico y tamaño ajustable de los botones; lista de invitados para volar; validar alturas en el servidor; ángulo de inclinación según velocidad; probar en celular real y con varios jugadores.

## Estado anterior (v6.49): el servidor hace cumplir «volar: solo su dueño»

- [x] **Servidor**: si un jugador **sin permiso** (no es el dueño de la parcela, ni quien creó el mundo, ni administrador) manda su posición con el estado **4 (volando)** dentro de una parcela con `fly: 'owner'`, el servidor **no la difunde** y le envía un `tp` a su **última posición recibida**, a nivel del suelo (y = 0), con lo que el cliente deja de volar. Fuera de la parcela, o con permiso, todo sigue igual. Antes (v6.47) solo lo aplicaba el cliente. Versión del paquete: 6.49.0.
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` **15** (+4: sin permiso no se difunde, lo devuelve a su última posición, fuera de la parcela sí puede volar, el dueño sí puede volar dentro); `test_client.py` 62 y las demás sin cambios.
- **Límite importante (sigue sin ser seguridad fuerte)**: el servidor solo ve lo que el cliente declara. Un cliente modificado que mande el estado **3 («en el aire») o 0** mientras vuela **no se detecta**; solo se frena a los clientes normales o a los que digan la verdad. Para cerrarlo del todo habría que que el servidor conozca el suelo/objetos y valide la altura (no existe hoy). Además: la devolución es a y = 0, que puede quedar dentro de un objeto si la última posición estaba sobre uno; si el primer mensaje de un jugador ya viene dentro de la parcela volando, no hay posición previa y simplemente se ignora; y el cliente pone al jugador sin aviso explícito (solo el mensaje «Te han teletransportado.»).
- **Qué NO se probó**: varios jugadores reales en navegador; el rebote con mucha latencia (el jugador puede ver unos fotogramas dentro antes de que llegue el `tp`).
- **Pendiente**: lista de invitados para volar; validar alturas en el servidor; ángulo de inclinación según velocidad; probar en celular real, joystick analógico y opción para ocultar botones.

## Estado anterior (v6.48): postura propia al volar

- [x] **Inclinación al volar**: cuando vuelas y **avanzas** (`W A S D`, flechas o la cruz táctil), el cuerpo del avatar se inclina hacia delante unos **34°** (0,6 rad) con suavizado, y vuelve recto al quedarte flotando o al aterrizar. Quieto en el aire usa la pose de «en el aire» de siempre (la animación `Jump`). No se añadió ningún clip al modelo `avatar.glb`: es una rotación del cuerpo.
- [x] **Los demás jugadores lo ven**: el cliente manda ahora el estado **4 = volando** (antes volar y saltar eran ambos 3 «en el aire»). Quien te mira se inclina cuando tu avatar se mueve en horizontal. El servidor admite 0–4 (cualquier otro valor vale 0). **Compatibilidad**: un cliente antiguo (v6.47 o menos) recibe el 4 y lo trata como «en el suelo» (reposo), porque solo conoce 0–3.
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` **11** (+2: el estado 4 se difunde, el 5 se descarta a 0); `python3 tools/test_client.py` **62** (+1: volando quieto el cuerpo va recto, al avanzar se inclina ~0,6 rad y al parar vuelve); las demás sin cambios. Versión del paquete: 6.48.0.
- **Revisión visual**: se miró una captura lateral (Chromium sin GPU) del avatar recto frente a inclinado 0,6 rad, con la inclinación forzada por código: el cuerpo entero se inclina, la cabeza se adelanta sin deformarse y los pies quedan cerca del suelo (el pivote en los pies se ve aceptable). Se vio con la pose de reposo/caminar, no con la de salto.
- **Qué NO se probó**: la captura de la postura **en pleno vuelo con la pose `Jump` y moviéndose de verdad** (la prueba numérica sí cubre eso, la visual no); los accesorios acoplados a la cabeza o la mano giran con el cuerpo (no se revisó cómo quedan); cómo lo ve otro jugador real (solo se probó el mensaje del servidor y el cálculo local); la inclinación con altura/complexión extremas.
- **Límites**: es una inclinación fija (no depende de la velocidad ni gira de lado al ir en diagonal); no hay animación de brazos extendidos ni de aleteo; no hay inclinación al subir o bajar sin avanzar.
- **Pendiente**: ángulo según velocidad e inclinación lateral en diagonal (el pivote en los pies se ve bien, no hace falta moverlo); que el servidor haga cumplir el permiso de vuelo por parcela; probar en celular real, joystick analógico y opción para ocultar botones; varios jugadores reales.

## Estado anterior (v6.47): permiso de vuelo por parcela

- [x] **Parcelas**: en la ventana de parcelas, junto a «Construir», hay un selector nuevo **Volar: cualquiera / solo yo**. Con «solo yo», en esa parcela **solo vuela su dueño** (también quien creó el mundo y el administrador). Los demás, al pulsar `E` (o ↑ Vuelo), reciben el aviso ««nombre» es de …: aquí no se puede volar»; y si **vuelan y entran** en ella, dejan de volar y caen. La lista de parcelas y el texto de «Estás en…» muestran también el permiso. Las parcelas nuevas permiten volar a cualquiera; las de mundos anteriores (sin el campo) también.
- [x] **Servidor**: `pset` acepta `fly` (`all` o `owner`; cualquier otro valor se ignora) y solo lo cambia el dueño de la parcela, quien creó el mundo o el administrador; `pclaim` crea con `fly: 'all'`. Se guarda con la parcela en `world.json`. Versión del paquete: 6.47.0.
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` **9** (+4: parcela nueva con `fly = all`, el dueño la pone en `owner`, valor inválido ignorado, otro jugador no puede cambiarlo); `python3 tools/test_client.py` **61** (+3: en parcela ajena con «solo su dueño» `E` no vuela y avisa, con «cualquiera» sí vuela, al entrar volando cae); las demás sin cambios.
- **Límite importante: lo hace cumplir el CLIENTE, no el servidor.** El servidor guarda y difunde el permiso, pero **no impide** que un cliente modificado vuele en una parcela protegida (no distingue un salto de un vuelo en la posición que recibe). Sirve como regla de convivencia, no como seguridad fuerte (igual que el aviso de permisos de objetos de v5.9). Además: el permiso es de la parcela rectangular completa y a cualquier altura; en terreno libre (sin parcela) siempre se puede volar; no hay lista de invitados.
- **Qué NO se probó**: la ventana de parcelas con el selector nuevo hecha clic a clic en un navegador (se probó por mensajes al servidor y con parcelas puestas por código en el cliente), ni varios jugadores reales, ni cambiar el permiso con la parcela ya ocupada por otro jugador que está volando.
- **Pendiente**: que el servidor haga cumplirlo (por ejemplo, acotar la altura difundida a quien no tiene permiso), lista de invitados; animación de vuelo propia; probar en celular real, joystick analógico y opción para ocultar botones; varios jugadores reales.

## Estado anterior (v6.46): techo al subir (volando o saltando)

- [x] **Techo**: al subir (con `E`, el botón ↑ Vuelo o un salto), la cabeza del avatar **ya no atraviesa** lo que tiene encima: una losa, un tejado o un puente a mayor altura lo detienen (queda a ~1,8 m × altura por debajo). Solo cuenta lo que está **por encima de la cabeza** en el momento de subir, así que desde arriba de la losa se sube sin problema y los escalones de al lado no estorban. Usa las mismas cajas envolventes que las colisiones de siempre. Es solo del cliente (el servidor no cambia). Versión del paquete: 6.46.0.
- [x] **Pruebas** (pasan): `python3 tools/test_client.py` **58** (+2: bajo una losa a 6 m la cabeza se detiene a ~4,2 m; encima de la losa sube normal), `test_vuelo.js` 5 y las demás sin cambios.
- **Qué NO se probó**: techos de grupos con puertas (colisionan pieza a pieza: entrar a una casa y subir bajo su techo no se miró), objetos girados o curvos (caja envolvente: un techo inclinado se comporta como una caja), el salto bajo un techo bajo, y ratón/táctil/varios jugadores reales.
- **Límites**: un objeto que **empieza por debajo de la cabeza** pero la atraviesa por arriba (por ejemplo, una viga que ya te toca) no frena la subida; los techos son cajas, no mallas; no hay golpe ni animación al chocar.
- **Pendiente**: permisos de vuelo por parcela o mundo; animación de vuelo propia; probar en celular real, joystick analógico y opción para ocultar botones; varios jugadores reales.

## Estado anterior (v6.45): botones en pantalla para caminar y volar en celular

- [x] **Controles táctiles**: en pantallas táctiles (`pointer:coarse`) aparecen, abajo, una **cruz ▲ ◀ ▶ ▼** (caminar, a la izquierda) y cuatro botones a la derecha: **⤒ saltar**, **» correr**, **↑ Vuelo** (mantener: sube y empieza a volar) y **↓ Bajar** (mantener: baja y aterriza). Se pueden **pulsar varios a la vez** (por ejemplo ▲ + ↑ Vuelo + »). Funcionan igual que el teclado: escriben en el mismo objeto `keys`, así que el vuelo, el límite de 120 m y el servidor no cambian. Con ratón los botones no se ven. La cámara se sigue girando arrastrando el dedo en el mundo.
- [x] **Pruebas** (pasan): `python3 tools/test_client.py` **56** (+7, con un contexto táctil de Chromium: aparecen con pantalla táctil y no con ratón, ↑ Vuelo sube y vuela, al soltar flota, ▲ avanza sin perder altura, ↓ Bajar aterriza, no queda ningún botón pulsado); `test_vuelo.js` 5, `test_facetex.js` 28, `test_prim.js` 25, `test_csg.js` 22 y `test_deploy.js` 11 siguen pasando.
- **Qué NO se probó**: un celular o tableta **reales** (solo Chromium con emulación táctil y eventos de puntero lanzados por código); el tamaño y la comodidad de los botones en pantallas pequeñas o en horizontal/vertical; que los botones no tapen la barra inferior (*dock*) ni las ventanas flotantes en celulares muy estrechos; el uso con varios dedos de verdad (cruz y botones a la vez); cámara, construir y mover objetos con el dedo (esos controles no se tocaron y siguen sin revisarse en táctil).
- **Límites**: **no hay joystick analógico** (la cruz es de 4 direcciones, sin velocidad intermedia); los botones se ven siempre en táctil (no hay opción para ocultarlos); `Mayús`+`E`/`C` más rápido solo se logra con el botón » mantenido; en equipos táctiles con ratón conectado los botones también aparecen.
- **Pendiente**: probar en un celular real y ajustar tamaños; joystick analógico y opción para ocultar los botones; permisos de vuelo por parcela o mundo; techo y colisión al subir; animación de vuelo propia; varios jugadores reales.

## Estado anterior (v6.44): el avatar puede volar (como en Second Life)

- [x] **Controles** (en celular, desde v6.45, con los botones en pantalla): **`E`** hace que el avatar empiece a volar y suba (mantenida); **`C`** baja; **sin teclas flota** en el aire; **`W A S D` / flechas** lo mueven en el aire (8 m/s, **`Mayús`** 14 m/s; en el suelo siguen 4 y 7); `Mayús` con `E`/`C` sube/baja más rápido (10 m/s en vez de 5). **Aterriza** bajando con `C` hasta el suelo o hasta lo alto de un objeto (entonces vuelve la gravedad y el salto con `Espacio`). La primera vez que vuelas sale un aviso con las teclas.
- [x] **Detalles**: altura máxima **120 m** en el cliente; vuela por encima de las piezas sin chocar (la colisión ya ignoraba lo que está por debajo de los pies) pero **sí choca de lado** con las que son más altas que tú. Pasa por teleports, cambio de mundo y «Ir» a un jugador: dejan de volar. Escribir «e» o «c» en el chat, o en cualquier campo, **no** hace volar. Los demás jugadores te ven en pose «en el aire» (estado 3 que ya existía) y a la altura real.
- [x] **Servidor**: la altura que se difunde se acota a **−20…150 m** (`MAX_Y`/`MIN_Y`), para que un cliente modificado no mande alturas absurdas; el techo de 150 es mayor que el de 120 del cliente a propósito.
- [x] **Pruebas** (pasan): `node tools/test_vuelo.js` (5, servidor real con dos jugadores: alturas normales, el techo, 9999 m → 150, −500 m → −20, estado «en el aire»), `python3 tools/test_client.py` **49** (+7: E sube y empieza a volar, aviso con las teclas, flota sin teclas, avanza con W sin perder altura, C baja y aterriza, tope de 120 m, escribir en el chat no hace volar), y las demás sin cambios (`test_facetex.js` 28, `test_prim.js` 25, `test_csg.js` 22, `test_deploy.js` 11). Captura: avatar en el aire con su sombra en el suelo y el aviso.
- **Qué NO se probó**: pantallas táctiles (**no hay botones en pantalla para volar**: en el celular no se puede usar `E`/`C`); teclados que no sean QWERTY ni con otra disposición (se usa el código físico de la tecla, `KeyE`/`KeyC`); la velocidad real de subida con un equipo lento (a menos de ~20 cuadros por segundo el avatar sube más despacio porque el paso se limita a 0,05 s); varios jugadores viéndose volar en un navegador de verdad; volar dentro de edificios.
- **Límites**: ~~no hay techo~~ (resuelto en v6.46); la animación de vuelo propia es solo una inclinación del cuerpo (v6.48); no hay botón «volar» ni tecla para alternar (`F` ya enfoca la selección); el suelo y la cuadrícula miden 60 m, así que a gran altura se ve el cielo y el fondo liso; los permisos de vuelo por parcela llegaron en v6.47 (solo en el cliente); el vuelo no consume ni tiene límite de tiempo.
- **Pendiente**: botones de subir/bajar para pantalla táctil; permisos de vuelo por parcela o mundo; techo y colisión al subir; animación de vuelo propia; probar con ratón/táctil y varios jugadores reales.

## Estado anterior (v6.43): luz real con radio

- [x] **Panel «Textura»**: casilla **Emite luz (punto de luz real)** con **Intensidad** (0,1–3) y **Radio** (2–40 m). Vale para cualquier forma (no grupos ni modelos), con el color de la pieza, y a diferencia del brillo (*glow*) **sí ilumina a los objetos vecinos**. Una pieza de material «luz» no emite luz real por sí sola: hay que activar la casilla (así los mundos anteriores se ven igual).
- [x] **Cómo funciona**: la escena lleva un **grupo fijo de 6 `PointLight`** (el número no cambia nunca, así no se recompilan todos los materiales); cada 0,25 s se reparten entre las piezas con luz **más cercanas a la cámara** (dentro de su radio + 60 m). Las demás luces quedan apagadas hasta que te acercas. Intensidad real = valor × 1,2.
- [x] **Guardado y servidor**: campo `lz` = `[intensidad, radio]` (`cleanLz`): se recortan los rangos, y si no son dos números se descarta. Pasa por plantillas (guardar, limpiar en cliente y en servidor), grupos (una pieza dentro de un grupo conserva su luz), duplicados e inventario.
- [x] **Fallo mío corregido durante el trabajo**: al insertar la línea de la luz en `addObj` dejé un comentario `//` en medio de una línea y comentó el resto (el guardado de las caras del CSG); la prueba de navegador lo detectó (5 fallos de CSG) y quedó corregido.
- [x] **Pruebas** (pasan): `test_facetex.js` +4 (24 → 28: guardar, recortar, descartar, grupo), `test_client.py` **42** (+4: la casilla guarda [2, 15] y enciende una luz con su radio y color; con 9 luces solo se encienden 6 y **el número de luces de la escena no cambia**; quitar la casilla la borra; sobrevive a la recarga), `test_prim.js` 25, `test_csg.js` 22, `test_deploy.js` 11. Captura de noche mirada: el suelo y la cara del cubo hacia la lámpara se iluminan en amarillo.
- **Qué NO se probó**: rendimiento con una GPU real o un celular (6 luces puntuales cuestan más en el sombreado de cada píxel; en el celular puede notarse); ratón/táctil reales; varios jugadores; el parpadeo al cambiar qué luces están encendidas cuando te mueves (puede haber un pequeño salto); luces dentro de objetos que el cliente oculta por lejanía.
- **Límites**: **las luces no proyectan sombras** (un objeto no tapa la luz: en la captura la cara trasera del cubo sigue iluminada por el suelo pero el cubo no sombrea el suelo); solo 6 a la vez; el color es el de la pieza (no hay color de luz aparte); el resto de jugadores ve la luz porque se guarda con la pieza, pero cada uno enciende las 6 más cercanas a *su* cámara; no hay luz tipo foco.
- **Pendiente**: sombras de luces puntuales (caras), color de luz independiente, foco (*spot*), parpadeo/animación de la luz con reglas; mapa de entorno y relieve por cara; «alinear a planos»; texturas en CSG y otras formas; probar con GPU real, ratón, táctil y varios jugadores.

## Estado anterior (v6.42): brillo especular (shininess) por cara

- [x] **Panel «Forma (prim)»**: selector **Brillo especular** (Como la pieza / Bajo / Medio / Alto), por cara o, con «Todas las caras», en las cinco. Baja la rugosidad de esa cara a 0,55 / 0,30 / 0,10 (nunca la sube, y no se aplica al vidrio). *Quitar forma y caras* lo borra.
- [x] **Guardado y servidor**: arreglo `fsh` de 5 enteros 0–3 (`cleanFaceSh`): decimales, texto o fuera de rango valen 0; todo en 0 o longitud distinta de 5 no se guarda; solo en prims. Pasa por plantillas, grupos, duplicados e inventario.
- [x] **Pruebas** (pasan): `test_facetex.js` +3 (21 → 24), `test_client.py` **38** (+3: la cara con especular alto baja su rugosidad y las otras no, el panel muestra el valor, sobrevive a la recarga), `test_prim.js` 25, `test_csg.js` 22, `test_deploy.js` 11. En la captura la tapa con especular alto se ve más clara que el lado, pero el efecto es **sutil**.
- **Límites**: no hay mapa de entorno, así que el especular solo reacciona a la luz direccional del sol (un reflejo difuso, no un espejo); no hay color ni intensidad de reflejo aparte (SL tiene «glossiness» y «environment»); no se probó con ratón/táctil reales, otros navegadores, varios jugadores ni GPU real; mismos límites de formas que v6.39.
- **Pendiente**: mapa de entorno / reflejos reales y mapa de relieve (*bump*) por cara; «alinear a planos»; texturas en piezas CSG y en el resto de formas; luz real (punto de luz con radio); sombras de caras transparentes; probar con ratón, táctil y varios jugadores.

## Estado anterior (v6.41): brillo (glow) por cara

- [x] **Panel «Forma (prim)»**: deslizador **Brillo de la cara** (0–100 %). Con una cara elegida solo brilla esa; con «Todas las caras», las cinco. La cara **emite su propio color** (y su textura, si la tiene) con esa intensidad, así que se ve plana y viva aunque esté en sombra. *Quitar forma y caras* lo borra.
- [x] **Guardado y servidor**: arreglo `fgl` de 5 números 0–1 (`cleanFaceGl`): se recortan, lo que no es número vale 0, y todo en 0 o longitud distinta de 5 no se guarda; solo en prims. Pasa por plantillas, grupos, duplicados e inventario.
- [x] **Selección**: antes, al deseleccionar, el resaltado ponía el brillo emisivo a 0 en todas las caras; ahora una cara con brillo lo conserva (también seleccionada) y las demás se limpian como siempre. Un cambio de color por reglas también actualiza el color de la luz de esa cara.
- [x] **Pruebas** (pasan): `test_facetex.js` +3 (18 → 21), `test_client.py` **35** (+4: la cara brilla con su color y las otras no, al deseleccionar sigue brillando y las otras no quedan teñidas, el panel muestra el valor de la cara, sobrevive a la recarga); `test_prim.js` 25, `test_csg.js` 22, `test_deploy.js` 11. Captura mirada: la pared interior amarilla al 90 % se ve plana y luminosa.
- **Qué NO se probó**: ratón/táctil reales, otros navegadores, varios jugadores, GPU real; con una cara que brilla **y** es transparente no se miró el resultado; los modelos importados y las piezas fusionadas de lejos no cambian (los prims no se fusionan).
- **Límites**: es «autoiluminación» (como el *glow*/*full bright* de SL), **no ilumina a los objetos vecinos** (sigue sin haber luz real ni sombras de ella); es un solo valor por cara (no hay color de brillo aparte del de la cara); no hay brillo especular por cara; mismos límites de formas que v6.39.
- **Pendiente**: brillo especular (shininess) y mapa de relieve por cara; «alinear a planos»; texturas en piezas CSG y en el resto de formas; luz real (punto de luz con radio) ; sombras de caras transparentes; probar con ratón, táctil y varios jugadores.

## Estado anterior (v6.40): repetición, desplazamiento y giro de la textura por cara

- [x] **Panel «Forma (prim)»**: con una cara elegida (no «Todas las caras») hay cinco campos: **Repetir X / Y** (±0,1–16; un valor negativo la espeja), **Despl. X / Y** (±1) y **Giro °** (±180). Se aplican solo a la textura de esa cara (del catálogo o subida) y no tocan la de las demás caras ni la de la pieza. *Quitar forma y caras* también los borra.
- [x] **Guardado y servidor**: nuevo arreglo `ftf` de 5 entradas (cada una `null` o `[repX, repY, despX, despY, giro]`), junto a `faces`, `ftex` y `fop` (en el código aparece como «v6.39b»). El servidor (`cleanFaceTf`) recorta los rangos, pone 0,1 si la repetición es casi cero, descarta entradas mal formadas, no guarda la transformación neutra (1, 1, 0, 0, 0) y solo la conserva en prims con 5 entradas. Pasa por plantillas, duplicados, grupos e inventario como el resto.
- [x] **Cómo se dibuja**: una cara con transformación usa **su propia copia** de la textura (el resto sigue compartiendo la del catálogo); la copia se libera con el material.
- [x] **Pruebas** (pasan): `test_facetex.js` +4 (guardar, recortar/descartar, neutra, longitud/sin prim), `test_client.py` **31** (+4: valores llegan a la textura de esa cara, el panel muestra los de cada cara, campos desactivados en «Todas las caras», sobreviven a la recarga), `test_prim.js` 25, `test_csg.js` 22, `test_deploy.js` 11. Además una captura: tapa con ajedrez ×2 y lado con ladrillo ×3 girado se ven bien.
- **Qué NO se probó**: ratón y táctil reales, otros navegadores, varios jugadores, GPU real; el espejo (repetición negativa) solo se probó en el servidor, no se miró dibujado; una imagen subida con transformación se vuelve a pedir al servidor (suele salir de la caché del navegador, sin medir).
- **Límites**: la repetición no se adapta al tamaño de la cara (como en SL con «estirar texturas» desactivado: un lado de 4 m y uno de 1 m muestran la textura con distinta escala); no hay «alinear a planos»; mismos límites de formas que v6.39.
- **Pendiente**: brillo (*glow*) y especular por cara; «alinear a planos» y repetición por metro; texturas en piezas CSG y en el resto de formas; sombras de caras transparentes; probar con ratón, táctil y varios jugadores.

## Estado anterior (v6.39): textura y transparencia por cara

- [x] **Panel «Forma (prim)»**: debajo del color de la cara hay ahora **textura de la cara** (las cinco del catálogo, o *Imagen…* para subir una PNG/JPG/WebP solo para esa cara) y **Opacidad de la cara** (10–100 %). Con «Todas las caras» la opacidad se aplica a las cinco (la textura de todas sigue siendo el selector «Textura» de la pieza). Una cara sin textura propia usa la de la pieza. Una caja, cilindro o prisma **sin forma** pasa a ser un prim neutro (mismo tamaño) al darle textura u opacidad a una cara. *Quitar forma y caras* borra también textura y opacidad.
- [x] **Guardado**: la pieza guarda `ftex` y `fop` (arreglos de 5, uno por cara, paralelos a `faces`; `faces` no cambia, así que los mundos anteriores se cargan igual). Pasan por `ser()`, `addObj`, plantillas (guardar, limpiar en el cliente y en el servidor), duplicados, grupos e inventario.
- [x] **Cómo valida el servidor** (`cleanFaceTex`, `cleanFaceOp`, `faceExtra`): solo se conservan si la pieza es caja, cilindro o prisma **con prim**; deben ser 5 entradas; cada textura es del catálogo o `u:<hash>.png|jpg|webp` **cuyo archivo existe en el servidor** (en plantillas solo se comprueba el formato, igual que `tex`); lo demás (rutas, esquemas, tipos raros) se **descarta sin rechazar la pieza**; la opacidad se recorta a 0,10–1 y lo que no es número vale 1; si todo está por defecto no se guarda nada. **La limpieza de archivos (v6.29) ya protegía estas imágenes** porque busca el nombre en todo el contenido: se comprobó.
- [x] **Fallo de antes corregido: los prims no tenían coordenadas UV** (`prim.js`), así que **ninguna textura se veía sobre un prim** (salía un color liso; se descubrió al mirar una captura de esta función). Ahora cada cara lleva UV: las tapas se proyectan desde arriba (la de abajo, espejada), los lados planos (caja, prisma) llevan cada uno la textura entera, los redondos dan una vuelta continua, y el corte y la pared interior llevan las suyas. **Cambio visible**: las piezas con forma que ya tenían textura en toda la pieza **ahora sí la muestran**.
- [x] **Pruebas** (todas pasan): `node tools/test_facetex.js` (14: sube PNG reales, manda datos válidos y falsos por WebSocket, lee `world.json`, y comprueba que la limpieza no borra imágenes usadas solo en una cara ni dentro de un grupo, y que sí borra la que nadie usa; se comprobó que **falla si se quita la validación**), `node tools/test_prim.js` (25, 10 nuevas de UV), `node tools/test_csg.js` (22), `node tools/test_deploy.js` (11) y `python3 tools/test_client.py` (**27**, 14 nuevas: panel real, subir imagen a una cara con el selector de archivos, opacidad, plantilla, recarga, caja sin forma, sin errores en consola). Además se miró una captura: tapa con ajedrez y lado de ladrillo al 35 % de opacidad se ven bien.
- **Qué NO se probó**: clic y arrastre reales con el ratón (`pickFace` se llamó por código), pantallas táctiles, otros navegadores, varios jugadores a la vez, una GPU real, ni **sombras** de las caras transparentes (en Three.js la sombra no depende de la opacidad, así que una cara al 10 % probablemente proyecta sombra entera: sin comprobar). Tampoco se probó el orden de dibujado con varias piezas transparentes superpuestas (pueden verse artefactos, igual que con el vidrio).
- **Límites**: solo en **caja, cilindro y prisma** (los de prim); no en esfera, toro ni demás formas, ni en piezas CSG (que siguen sin textura). Una cara no puede quedar «sin textura» si la pieza tiene una (hereda la de la pieza). Una textura subida a una cara cuenta para la cuota de archivos. Si el archivo de una textura de plantilla ya no existe en el servidor, la cara se ve lisa (igual que ya pasa con `tex`). Sigue sin haber desplazamiento, repetición ni giro de la textura.
- **Pendiente**: brillo (*glow*) y especular por cara; «alinear a planos»; texturas en piezas CSG y en el resto de formas; sombras de caras transparentes; probar con ratón, táctil y varios jugadores; colisiones que respeten huecos; más de dos piezas en CSG; hoyuelo, radio delta, luz real y terreno editable.

## Estado anterior (v6.38): primera prueba real en navegador (y un fallo corregido)

- [x] **`tools/test_client.py` (nuevo)**: prueba de extremo a extremo en **Chromium sin interfaz** contra un servidor temporal (copia del proyecto, no toca tu `world.json`). Usa los controles de verdad: panel «Forma (prim)» (hueco, torsión, corte), color de la cara interior, `pickFace`, *Guardar plantilla*, *Restar*, *Unir* e *Intersecar sólidos*, **recarga la página** y comprueba que las piezas con prim y csg siguen iguales, que la plantilla se guardó en el servidor y que no hubo errores en la consola. **13 comprobaciones, todas pasan.** Uso: `npm install`, `pip install playwright`, `playwright install chromium` y `python3 tools/test_client.py --captura captura.png`.
- [x] **Fallo real encontrado y corregido (v6.34)**: al seleccionar otra cosa después de dar colores por cara a una pieza, `glow()` fallaba (`emissive` de un arreglo de materiales) y el resaltado dejaba de funcionar con un error en consola. Ahora recorre todos los materiales (`matsOf`).
- [x] **Mejora del CSG**: el árbol BSP **fragmenta mucho** (dos esferas finas de 32×20 dan **14 255 triángulos** al unirse). Ahora el editor prueba primero con las formas finas y, si el resultado pasa de **3000 triángulos** (antes 1500; el servidor valida lo mismo), **reintenta con la versión simplificada** de las formas redondas (la misma que se usa de lejos: esfera 12×8, etc.) y lo avisa en el mensaje. Con eso la unión de dos esferas queda en ~1400 triángulos. Cajas, prismas y cilindros con agujeros no suelen necesitar el reintento.
- **Qué se probó y qué no**: solo vía scripts (eventos y llamadas a las funciones del cliente) en Chromium con dibujado por software; **no se probó** el arrastre/clic real con el ratón (incluido tocar una cara de verdad), pantallas táctiles, otros navegadores, varios jugadores a la vez, ni el rendimiento con una GPU real. `pickFace` se probó llamándola con una cara concreta, no con un clic.
- **Pendiente**: lo de la lista de abajo (más de dos piezas en CSG, texturas por cara, colisiones con huecos, luz real, terreno editable…). Un siguiente paso útil: reducir la fragmentación del CSG (descartar de la unión las caras lejos de la zona de contacto y fusionar triángulos coplanares).

## Estado anterior (v6.37): unir, restar e intersecar sólidos desde el editor

- [x] **Tres botones nuevos** en la ventana de edición: *Unir sólidos*, *Restar sólidos* e *Intersecar sólidos*. Selecciona **dos** formas (Mayús+clic): la primera es **A** y la segunda **B**; en la resta, B corta a A. Las dos formas se sustituyen por **una pieza nueva** (tipo `csg`) y se puede **deshacer** con Ctrl+Z. Cada parte conserva su color (A y B quedan como dos colores por grupo; al cambiar el color principal toda la pieza toma ese color).
- [x] **Guardado**: la pieza guarda su malla en `csg: {v, g}` (coordenadas en milésimas enteras + vértices por grupo) con un máximo de **3000 triángulos**. `server.js` la valida con `cleanCsg` (enteros, |n| ≤ 200 m, múltiplos de 9, grupos que suman, ≤ 3000 triángulos); sirve también en grupos, duplicados e inventario. `ser()` y `addObj` la guardan y reconstruyen; las piezas `csg` no se simplifican ni se funden al alejarse.
- [x] **Pruebas** (`node tools/test_csg.js`, 20 comprobaciones, pasan): motor con volúmenes exactos, empaquetar → JSON → desempaquetar conserva volumen y grupos, y 6 casos de rechazo del servidor. `node tools/test_prim.js` sigue con sus 15. Sintaxis de cliente y servidor revisada con `node --check`.
- **Qué NO se probó**: **no hay navegador aquí**, así que los botones, el orden de selección (A/B), el deshacer y el dibujado del resultado no se han visto funcionando, y no se probó el servidor con una sesión real (crear una pieza combinada, reiniciar y recargar). Pruébalo: crea un cubo y un cilindro, selecciónalos en ese orden y pulsa *Restar sólidos*.
- **Límites**: solo se combinan **dos formas sueltas** y sólidas (se rechazan grupos, modelos `.glb`, objetos con reglas, objetos acoplados y formas abiertas como plano, cúpula o tubo); **se pierden las texturas** (el resultado no lleva textura) y los colores por cara de prim (solo se conserva el color principal de cada pieza); una pieza combinada **no se puede guardar en plantillas** (el cliente avisa) ni se edita con el panel de forma, aunque sí se puede volver a combinar; las colisiones siguen usando la caja envolvente; con muchos lados el resultado supera los 3000 triángulos y se rechaza; el resultado es una malla plana (aristas duras).
- **Pendiente**: probar en navegador; combinar más de dos piezas a la vez; que la combinación conserve texturas y colores por cara; plantillas con piezas combinadas; colisiones que respeten huecos.

## Estado anterior (v6.36): motor de unión, resta e intersección de sólidos (CSG)

- [x] **`public/csg.js` (nuevo)**: `csgGeo(geoA, matA, geoB, matB, 'union' | 'subtract' | 'intersect')` combina dos sólidos cerrados (los de `prim.js` o las formas básicas) con un árbol BSP y devuelve una geometría sin índice. Las caras que vienen de A llevan el grupo 0 y las de B el grupo 1, de modo que **cada parte conserva su color**; en una resta, las paredes del corte salen con el material de B. Rechaza (devuelve `null`) operandos de más de 4000 triángulos.
- [x] **`node tools/test_csg.js`** (12 comprobaciones, pasan): dos cajas solapadas con caras coplanares (unión 1,5, resta 0,5, intersección 0,5), cajas separadas, intersección vacía, caja − cilindro que la atraviesa (volumen exacto al 0,01 %), prim hueco − caja, operando enorme → `null`, normales válidas y rendimiento (dos cilindros de 32 lados: ~50 ms en Node).
- *(Resuelto en v6.37: ya está conectado al editor y al servidor.)*
- **Diseño propuesto para conectarlo (v6.37)**: (1) con **dos** piezas seleccionadas aparecen *Unir sólidos / Restar / Intersecar* (la primera seleccionada es A, la segunda B, y en la resta B es la que corta); (2) el resultado es una pieza nueva de tipo `csg` que guarda su malla: posiciones cuantizadas a milésimas, una tabla de colores/material por grupo y un límite de triángulos (p. ej. 6000) que el servidor valida igual que hace con `prim`; (3) el resultado no se vuelve a editar con el panel de forma (solo mover, girar, escalar y colorear por grupo), y se conserva la opción de **deshacer**; (4) como los resultados no se simplifican, se excluyen de la fusión por distancia, igual que los prims.
- **Límites del motor**: necesita sólidos cerrados (los modelos `.glb` con huecos o mallas abiertas pueden dar resultados raros); con triángulos casi coplanares puede dejar astillas diminutas; el coste crece rápido con los triángulos (por eso el tope).

## Estado anterior (v6.35): clic para elegir la cara y plantillas con prims

- [x] **Elegir la cara con el clic**: al hacer clic sobre una pieza con forma (prim) ya seleccionada, el selector «Cara» del panel salta a la cara tocada (arriba, abajo, lado, corte o interior); luego se cambia su color. Solo en piezas que ya tienen forma (con grupos de caras): en una caja normal hay que darle antes algún parámetro o un color de cara.
- [x] **Plantillas conservan `prim` y `faces`**: *Guardar plantilla*, la limpieza del cliente (`cleanTpl`, `primC`) y la del servidor (`cleanTplS`) ya no los descartan; al colocarla, `buildKids` → `addObj` los reconstruye. Las miniaturas de plantillas propias siguen sin dibujar la forma.
- **Qué NO se probó**: igual que en v6.34, **no hay navegador aquí**: el clic sobre caras, el guardado de plantillas con prims y su colocación no se han visto funcionando. Solo se revisó la sintaxis (`node --check`) y siguen pasando las 15 pruebas de `tools/test_prim.js`; la validación de plantillas del servidor no tiene prueba propia.
- **Pendiente**: probar todo en navegador; textura, brillo y transparencia por cara; colisiones que respeten el hueco; CSG (unión/resta); hoyuelo, radio delta, revoluciones.

## Estado anterior (v6.34): prims de Second Life conectados al mundo

- [x] **Ventana de edición → «Forma (prim)»** (aparece al seleccionar **una** caja, cilindro o prisma): corte desde/hasta, hueco, torsión, afilado y desplazamiento. Cada cambio regenera la geometría (`public/prim.js`, cargado desde `index.html`) y se guarda.
- [x] **Color por cara**: elige «Arriba, Abajo, Lado, Corte o Interior» y su color; «Todas las caras» vuelve al color único. *Quitar forma y colores por cara* restaura la pieza original.
- [x] **Guardado y servidor**: la pieza guarda `prim` y `faces` (`ser()`); `server.js` los valida con `cleanPrim` (corte 0–0,98, hueco 0–0,95, torsión ±180°, afilado y desplazamiento ±1, colores `#rrggbb`) en objetos, grupos anidados e inventario. Las piezas con prim **no se simplifican ni se funden** al alejarse (v6.30/6.31) porque eso reemplazaría su forma.
- [x] **Pruebas**: `node tools/test_prim.js` (15 comprobaciones: geometría, volúmenes, grupos y validación del servidor). Sintaxis del cliente y del servidor revisada con `node --check`.
- **Qué NO se probó**: no hay navegador en este entorno, así que **la ventana, el dibujado y el color por cara no se han visto funcionando**; tampoco se probó el servidor con una sesión real (guardar, reiniciar, recargar). Abre el mundo, crea una caja, mueve cada control y comprueba que se guarda al recargar.
- **Límites conocidos**: no se aplica a esfera, toro, tubo ni al resto de formas; las colisiones siguen usando la caja envolvente (un hueco no se puede atravesar); el *prisma* usa el radio circunscrito (queda algo más ancho que el prisma antiguo); no hay hoyuelo, radio delta, revoluciones ni torsión inicial por separado; en grupos solo se edita con la pieza seleccionada sola.
- **Siguiente**: probar en navegador y corregir; luego CSG (unión/resta).

## Estado anterior (v6.33): análisis de Second Life y generador de prims


**Qué se revisó y qué no.** El zip no traía videos y no puedo reproducirlos; la lista sale del código de este proyecto comparado con las herramientas de construcción de Second Life (conocimiento general, **sin buscar en la web en esta pasada**: conviene verificar los números con la wiki de SL). Todo lo marcado «falta» sigue sin hacerse.

- [x] **`public/prim.js` (nuevo): generador de prims tipo SL.** `primGeo({sides, cutB, cutE, hollow, twistB, twistE, taperX, taperY, shearX, shearY, levels})` devuelve una geometría con **grupos por cara**: 0 tapa superior, 1 inferior, 2 lateral, 3 caras de corte, 4 pared interior del hueco. Con un arreglo de materiales (uno por cara) se puede dar **un color distinto a cada lado**. Cubre caja (`sides:4`), prisma (3, 6…), cilindro (32), corte de trayecto, hueco, torsión, afilado y desplazamiento.
- [x] **`node tools/test_prim.js`** (12 comprobaciones, pasan): volúmenes exactos (caja = 1; hueco 0,5 → ×0,75; corte a la mitad → mitad; corte + hueco coherente; desplazamiento conserva volumen), grupos correctos y normales sin NaN. La torsión da un error de volumen del 2 % con 24 niveles y baja a 0,5 % con 96.
- *(Resuelto en v6.34: ya está conectado al cliente y al servidor.)*

### Lista de lo que hace Second Life (y estado aquí)

**Prims (forma)**
1. Formas base: caja, cilindro, prisma, esfera, toro, tubo, anillo, árbol, césped. → **Hecho** (≈35 formas, v5–v6)
2. Corte de trayecto (inicio/fin), hueco con forma de hueco, torsión, afilado, desplazamiento superior, hoyuelo, radio delta, revoluciones, inclinación. → **Parcial (v6.34, en el editor)**: corte, hueco, torsión, afilado y desplazamiento en caja, cilindro y prisma; faltan hoyuelo, radio delta, revoluciones, inclinación y las formas toro/tubo/anillo con estos parámetros
3. **Unir** objetos (enlazar). → **Hecho** (grupos, y grupos anidados v6.28; en SL solo hay 256 piezas por enlace y aquí no)
4. **Unión, resta e intersección sólida (CSG)**, lo que pides con «recortar». → **Hecho (v6.37, sin probar en navegador)**: botones Unir / Restar / Intersecar con dos formas; falta texturas, más de dos piezas y plantillas. *(Texto anterior:)* SL no lo tiene; el truco habitual es una pieza hueca o con corte. Hacerlo de verdad exige una librería de CSG (p. ej. three-bvh-csg) o escribir una propia; hay que cuidar el tiempo de cálculo y guardar el resultado como malla
5. **Sculpties** (mapa de imagen que define una malla) y **mallas** importadas con LOD y físicas. → **Parcial**: importar `.glb` ya existe (v5.6); faltan los sculpt maps (imagen → geometría), el LOD propio y editar la malla
6. Prims **flexibles** (ondean), **luz** (color, intensidad, radio, caída), **brillo** y **partículas**. → **Parcial (v6.43)**: luz puntual real con color de la pieza, intensidad y radio (6 a la vez, sin sombras); falta flexibles, foco, caída ajustable y partículas

**Texturas y materiales (por cara)**
7. Color, textura, transparencia, brillo (glow), «full bright», brillo especular y bump **por cara**. → **Parcial (v6.42)**: color, textura (con repetición, desplazamiento y giro), transparencia, brillo (glow) y especular por cara en caja, cilindro y prisma; falta «full bright», reflejos reales y relieve (bump), y texturas en CSG y otras formas
8. Desplazamiento, repetición y giro de la textura; alinear a planos. → **Falta**
9. Materiales PBR (SL ahora usa glTF), mapa de normales y de especularidad. → **Falta**

**Edición**
10. Ejes, mover/girar/escalar, copiar arrastrando, varios objetos, deshacer/rehacer. → **Hecho** (v5.2)
11. **Editar partes enlazadas** (seleccionar una cara o una pieza dentro del grupo), «estirar texturas», ajuste a cuadrícula, escalado de todo el grupo. → **Parcial**: falta elegir la **cara** con el ratón
12. Tomar copia, guardar en inventario, permisos, cuentas. → **Hecho** (v5.9–v6.0); faltan vender y la economía

**Mundo**
13. Parcelas, scripting por reglas, día/noche, varios mundos, amigos. → **Hecho** (v6.1, v6.2, v5.8)
14. Terreno **editable** (subir/bajar, texturas), agua, cielo y nubes. → **Falta** (el suelo es un plano de 200 × 200)
15. Física (objetos que caen, empujar, vehículos), voz por cercanía, chat de grupo. → **Falta**

### Siguiente paso sugerido (en este orden)
1. ~~Conectar `prim.js`~~ y ~~colores por cara~~ (v6.34, falta probar en navegador). Pendiente: elegir la cara con el ratón.
3. ~~Conectar el CSG~~ (v6.37). Pendiente: probar en navegador, más de dos piezas, texturas y plantillas.
4. Después: hoyuelo y radio delta, sculpties, luz real, terreno editable.

## Estado anterior (v6.32)

- [x] **Punto 14, parte 1: publicar en internet (solo el servidor)**. Todo es opcional y por variables de entorno; sin ellas el servidor se comporta como antes. `DATA_DIR` (carpeta de `world.json` y `uploads/`, para un volumen persistente), `HOST`, `TRUST_PROXY=1` (detrás de nginx, Caddy o Cloudflare: la IP real sale de `X-Forwarded-For`; **antes todos los jugadores detrás de un proxy compartían una IP, así que 5 contraseñas mal puestas bloqueaban el inicio de sesión a todos**), `ALLOWED_ORIGINS=https://tu.dominio` (solo esas páginas pueden abrir el WebSocket; vacío = cualquiera), `MAX_CONN_IP` (20 conexiones simultáneas por IP, error 429 al pasarse)
- [x] **`/healthz`** (responde `{"ok":true}`), **latido** (el servidor envía un ping cada 25 s: mantiene viva la conexión tras proxies que cortan a los 60 s y cierra las que ya no responden), `Dockerfile` (Node 22, datos en el volumen `/data`, con `HEALTHCHECK`) y `.dockerignore`
- [x] **Cómo publicarlo**: `docker build -t mundo .` y `docker run -d -p 3001:3001 -v mundo-datos:/data -e TRUST_PROXY=1 -e ALLOWED_ORIGINS=https://mundo.ejemplo.com mundo`, con un proxy que ponga HTTPS por delante y deje pasar WebSocket (en Caddy: `mundo.ejemplo.com { reverse_proxy localhost:3001 }`; en nginx hacen falta las cabeceras `Upgrade` y `Connection`). El cliente ya usa `wss://` solo cuando la página va por HTTPS. **Antes de abrirlo crea tu cuenta**: la primera cuenta es la administradora
- [x] Versión del paquete: 6.32.0
- **Qué se probó** (`node tools/test_deploy.js`, servidor real, 11 comprobaciones): arranque con `DATA_DIR` (crea `uploads/` ahí), `/healthz`, la página sigue sirviéndose, origen no permitido → 403, permitido (aunque la variable lleve barra final) → conecta, tercera conexión de una misma IP → 429, otra IP conecta, al cerrar se libera el cupo, **sin `TRUST_PROXY` cambiar `X-Forwarded-For` no evita el límite**, sin `ALLOWED_ORIGINS` cualquiera conecta, y `SIGTERM` guarda `world.json` en `DATA_DIR`. `tools/test_merge.py` sigue pasando
- **No se probó**: el latido (pasa a ser un ping cada 25 s; no se esperó a que corte una conexión muerta), la imagen de Docker (`docker build` no estaba disponible aquí), un proxy real con HTTPS, ni la carga con muchos jugadores. Con `TRUST_PROXY=1` hay que tener **de verdad** un proxy delante: sin él cualquiera puede falsear su IP con la cabecera
- **Límites / lo que falta del punto 14**: las contraseñas siguen sin recuperación; no hay HTTPS propio (lo pone el proxy); `world.json` sigue siendo un solo archivo en un solo proceso (hallazgo 7), así que no se puede repartir en varias máquinas; **economía** (moneda, vender objetos) y **voz** (WebRTC por cercanía) no están hechas
- **Siguiente sugerido**: 14, parte 2: economía mínima (saldo por cuenta, pagar a otro jugador y poner precio a un objeto), apoyada en las cuentas y el administrador ya existentes; o la parte 3, voz por cercanía

## Estado anterior (v6.31)

- [x] **Fusión de objetos lejanos (punto 12, bajar las llamadas de dibujo)**: un grupo **sencillo** que queda a más de **30 m** de la cámara (vuelve a piezas sueltas a los 24 m) se dibuja como **una malla por material** (mate, metal, brillante; el color de cada pieza va por vértice) en vez de una por pieza. Más allá de **70 m** se usa un segundo nivel que omite además las piezas que serían menores de 1,5 px. La malla fusionada es hija del grupo (así los clics y las colisiones la resuelven igual que antes) y las piezas originales pasan a la capa 1; `ser()` la ignora, de modo que **nunca se guarda ni se envía** al servidor. Va dentro del mismo culling (4 veces por segundo) y se apaga con la casilla *Ocultar y simplificar lo lejano*; *Ajustes → Rendimiento* añade «fusionados: N»
- [x] **Qué se fusiona y qué no**: solo grupos sin reglas (ni en el grupo ni en sus piezas), sin texturas propias, sin vidrio ni material luminoso, sin modelos `.glb`, no acoplados al avatar y con al menos 2 piezas (los subgrupos sí entran). Seleccionar un objeto (o cambiarle el tamaño, o que llegue una actualización del servidor) **deshace la fusión al instante**: se descarta la malla y se vuelve a las piezas, así que editar no cambia. Al borrar un objeto se libera la geometría fusionada, que también se libera cuando el objeto queda muy lejos o muy cerca
- [x] **`tools/benchmark.py` determinista**: ahora fija la cámara (3 vistas desde el centro, 40 m) para que dos ejecuciones sean comparables (antes las cifras variaban según lo que se veía en ese instante). **Las cifras de v6.30 de más abajo se midieron con la versión anterior del script y no son comparables con las de v6.31**
- [x] **`tools/test_merge.py`**: prueba en Chromium sin interfaz con el cliente y el servidor reales (copia temporal, no toca tu mundo). 13 comprobaciones más la comparación de imagen; ver abajo
- [x] Versión del paquete: 6.31.0
- **Resultados** (mismo mundo denso: 2000 grupos × 8 piezas = 16 000 piezas en 220×220 m, 800×500, Chromium sin GPU, 3 vistas fijas): **llamadas de dibujo por fotograma 2840 → 1106 (−61 %)**; CPU dentro de `render()` 78,7 → **52,9 ms (−33 %)**; tiempo por fotograma (dibujado por software) 947 → 922 ms (sin cambio apreciable); pero **triángulos por fotograma 181 381 → 225 535 (+24 %)** y **geometrías en memoria 30 → 1223**. Es decir: se cambia más geometría por menos llamadas. En una GPU real las llamadas suelen ser el límite y los triángulos no, pero **eso no se midió** (ver límites)
- **Qué se probó** (`tools/test_merge.py`, mundo de 120 grupos entre 35 y 90 m): 113 de 120 se fusionan (los otros 7 son los más cercanos o los que tienen reglas); un grupo con una pieza con reglas **no** se fusiona; las piezas originales quedan en la capa 1 y la malla fusionada en la 0 (0 incoherencias); un rayo contra un objeto fusionado golpea la malla fusionada y se resuelve al grupo correcto; seleccionarlo lo deja en piezas visibles al instante, sin tocar los materiales compartidos (el resaltado no los tiñe); `ser()` de todo el mundo es **idéntico** con y sin fusión; apagar la casilla deja 0 fusionados y 0 piezas ocultas y volver a encenderla vuelve a fusionar; **diferencia de imagen con/sin fusión: 0,01 %** de los píxeles (solo el mundo 3D, sin ventanas); sin errores de página
- **No se probó / límites**: **sin GPU real ni celular** (los milisegundos de arriba son por software y solo comparan versiones); **la memoria de vídeo sube**: cada objeto fusionado lleva su propia geometría (en el mundo denso, 1810 objetos fusionados, unos 50 MB estimados, **sin medir**); en un mundo con muchos objetos distintos cerca del límite de 30 m, entrar y salir de ese radio reconstruye mallas (cuesta CPU); **no se probó con varios jugadores** ni arrastrando objetos propios lejanos con el ratón (solo la selección por código); los objetos con reglas, texturas, vidrio, luz o modelos `.glb` siguen dibujándose pieza a pieza; la fusión no reduce las llamadas de las sombras de forma medida por separado; la fusión de un grupo cuyas piezas cambian de color por otro motivo que no sea una edición o una actualización del servidor (no existe hoy) se quedaría con el color viejo
- **Siguiente sugerido**: medir con una GPU real (`tools/benchmark.py` en un equipo con GPU, comparando con `tools/benchmark.py` de v6.30 sin la fusión) y, si la memoria o los triángulos molestan, subir `MERGE_D` o limitar cuántos objetos se fusionan a la vez; después, instanciar (`InstancedMesh`) las piezas repetidas, o el punto 14 (economía, voz y publicar en internet), dividido en partes

## Estado anterior (v6.30)

- [x] **Rendimiento con muchas piezas (punto 12, parte de LOD y medición)**: tres cambios en el cliente. (1) **Geometrías compartidas**: antes cada pieza creaba su propia geometría; ahora se comparten por tipo (en el mundo de prueba, de 3155 geometrías en memoria a 31). Los materiales siguen siendo uno por pieza porque se modifican (color, resaltado). (2) **Bajo detalle por tamaño aparente**: las curvas (esfera, cilindro, cono, toro, tronco, disco, cúpula, nudo) tienen una variante de pocos polígonos que se usa cuando la pieza mide menos de 14 píxeles de radio en pantalla (vuelve al detalle completo a los 18 px). (3) **Piezas diminutas**: las que miden menos de 1,5 px de radio no se dibujan (vuelven a los 2,2 px), tampoco en la pasada de sombras. Se decide **por pieza**, no por objeto, con la distancia real a la cámara; los modelos `.glb` y los accesorios acoplados al avatar no se tocan. Va dentro del culling de v6.17: se recalcula 4 veces por segundo, y se apaga con la casilla *Ocultar y simplificar lo lejano* (*Ajustes → Rendimiento*, que ahora también cuenta las piezas ocultas y simplificadas)
- [x] **`tools/benchmark.py`**: mide en un Chromium sin interfaz geometrías, triángulos, llamadas de dibujo y milisegundos con un mundo generado (por defecto 2000 grupos de 8 piezas en 220×220 m). Trabaja en una copia temporal: no toca tu `world.json` ni `uploads/`. Necesita `pip install playwright` y `playwright install chromium`
- [x] Versión del paquete: 6.30.0
- **Resultados** (mundo denso, 2000 grupos × 8 piezas = 16 000 piezas en 220×220 m, 800×500, Chromium sin GPU): geometrías 3155 → **31**; triángulos por fotograma 764 563 → **146 547** (−81 %); CPU dentro de `render()` 86 → **52 ms**; tiempo por fotograma (dibujado por software) 1623 → **~800 ms**. Llamadas de dibujo 2262 → 2213: **casi no bajan**
- **Qué se probó**: el cliente real en Chromium con el servidor real. Comparación de capturas antes/después en el mismo mundo: **0,31 % de píxeles con diferencia apreciable** (media 0,28/255). Apagar la casilla restaura todo (0 piezas simplificadas u ocultas, sin capas inconsistentes), volver a encenderla da exactamente los mismos números, y al caminar 70 m el recuento se recalcula; sin errores de página
- **No se probó / límites**: **no se midió en una GPU real ni en un celular** (el dibujado por software solo sirve para comparar versiones entre sí; los milisegundos absolutos no valen para predecir los fotogramas por segundo); el coste que queda son las **llamadas de dibujo** (una por pieza visible y otra para las sombras): bajarlas exigiría fusionar o instanciar mallas, que no está hecho; no se probó aparte el camino «seleccionar un objeto lejano» (usa la misma rama que apagar la casilla, que sí se probó); las piezas diminutas ocultas no se pueden seleccionar con el ratón (miden menos de 2 píxeles); piezas muy finas pero largas (un cable de 20 m de largo) cuentan por su radio, que es grande, y no se ocultan; sin probar con varios jugadores
- **Siguiente sugerido**: medir con una GPU real y, si las llamadas de dibujo siguen siendo el límite, fusionar o instanciar las piezas de objetos que no se editan; o el 14 (economía, voz y publicar en internet), dividido en partes

## Estado anterior (v6.29)

- [x] **Límite de tamaño único (hallazgo 3)**: cliente y servidor aceptan ahora el mismo rango, **0,01 a 100** (constantes `MIN_SCALE` / `MAX_SCALE` en los dos). Antes el servidor cortaba a 0,05 en todos los niveles y el cliente a 0,1 solo en objetos de primer nivel, de modo que piezas finas de las plantillas (por ejemplo 0,04 en las patas del pupitre) se recortaban en silencio. Ahora se conservan. Los campos de tamaño de la ventana *Construir* aceptan desde 0,01 y escribir un valor fuera de rango en un eje lo ajusta al límite
- [x] **Limpieza de `uploads/` (hallazgo 4)**: el servidor borra los archivos subidos que ninguna cosa usa. «En uso» = su nombre aparece en algún objeto (con subgrupos), en un inventario, en las plantillas guardadas o en la papelera de un jugador conectado; se busca por nombre en todo ese contenido, así que cubre modelos `.glb`, texturas propias y campos que se añadan en el futuro. Solo se borra lo que lleva **más de 7 días** sin usarse (`GC_DAYS`), para no perder un archivo recién subido que aún no se ha colocado. Se ejecuta al arrancar y cada 6 horas, también retira los registros sin archivo, libera la cuota de quien lo subió y escribe en la consola cuántos archivos y MB borró. Solo toca archivos con nombre de hash (64 hex + extensión): otros archivos de la carpeta no se tocan. Volver a subir un archivo idéntico refresca su fecha
- [x] **Punto 13 revisado**: ya existen la lista de amigos (invitación y mensajes), los lugares guardados (v6.4) y la hora del día con ciclo automático (v6.4). Queda, si se quiere: que los lugares guardados vivan en el servidor y sigan a la cuenta (hoy están en `localStorage`) y una hora del día compartida entre jugadores (hoy cada uno ve la suya)
- [x] Versión del paquete: 6.29.0
- **Qué se probó**: **con el servidor real** (sin jugadores simulados a mano: WebSocket y `/upload` de verdad), 17 comprobaciones: se suben 7 imágenes y se envejecen 10 días; se conservan la usada como textura en un objeto suelto, la que está dentro de un subgrupo, la del inventario, la de una plantilla guardada y la reciente sin uso; se borran la que quedó sin uso, la de un objeto borrado, un archivo con nombre de hash sin registro; `notas.txt` no se toca; `world.assets` pierde los registros borrados, el archivo borrado da 404 y se puede volver a subir. Límites de tamaño con el servidor real: 0,04 se conserva, 0,001 pasa a 0,01 y 500 a 100, tanto en un objeto suelto como en un subgrupo. **En Chromium sin interfaz** con el cliente real: la página carga sin errores y la función `lim` ajusta 0,001 → 0,01, 500 → 100 y deja 0,04
- **No se probó**: que la papelera de un jugador **conectado** proteja su archivo en el momento de la limpieza (el código lo recorre, pero la limpieza solo corre al arrancar y cada 6 h, y al arrancar no hay nadie conectado); la limpieza con un `uploads/` muy grande; editar tamaños muy pequeños con el ratón en el navegador (el gizmo de escalado); ni varios jugadores a la vez
- **Límites**: un archivo que solo usa una plantilla local del navegador (aún no sincronizada con el servidor) se puede borrar pasados los 7 días; la plantilla seguirá en el navegador pero ese modelo o imagen no se colocará hasta volver a subirlo. No hay botón ni orden de administración para lanzar la limpieza a mano (solo arranque, cada 6 h y `GC_DAYS`)
- **Siguiente sugerido**: 14 (economía, voz y publicar en internet; muy grande, conviene dividirlo) o 12 (LOD y medir rendimiento con muchos objetos); los hallazgos 5 (cuentas con rol de administrador) y 7 (base de datos en vez de un JSON) son los que más limitan al 14

## Estado anterior (v6.28)

- [x] **Grupos anidados (punto 9)**: ahora se pueden agrupar grupos con otros objetos (Mayús+clic para elegir varios y *Agrupar*), hasta **3 niveles** y **200 piezas en total**. Un grupo puede llevar subgrupos; *Desagrupar* deshace solo el nivel de arriba y los subgrupos quedan como grupos sueltos. Al guardar, recargar, duplicar, regalar o meter al inventario, los subgrupos viajan con el grupo
- [x] **Reglas con grupos anidados**: las reglas (puertas, portones) funcionan en las **piezas y subgrupos de primer nivel** del grupo; así una puerta hecha de varias piezas se agrupa y se abre entera. Las piezas de niveles más profundos no tienen reglas: el servidor las descarta y el cliente avisa con una confirmación antes de agrupar si se fueran a perder. El selector *Pieza del grupo* muestra los subgrupos como «subgrupo (n)»
- [x] **Arreglo**: al agrupar o desagrupar ya no se arrastra el índice de pieza antiguo (`ci`), que podía mandar el clic de una puerta a la pieza equivocada
- [x] **Servidor**: `clean()` valida recursivamente (máx. 3 niveles, 200 piezas en total, sin modelos `.glb` dentro de grupos) y el cálculo de radio para enviar solo lo cercano (`itRadius`) tiene en cuenta los subgrupos
- [x] Versión del paquete: 6.28.0
- **Qué se probó**: la validación del servidor aislada, con 13 casos (grupo plano, subgrupo, 3 niveles OK, 4 niveles rechazado, subgrupo vacío, 200 y 201 piezas, reglas de primer nivel conservadas y de nivel 2 descartadas, modelo dentro de grupo, pieza inválida, `att` solo en el nivel 0); y **en un Chromium sin interfaz con el cliente real** (sin servidor): agrupar 4 cubos en 2 subgrupos y un grupo superior, guardar a JSON y recargar (misma estructura, índices `0,1`), contar piezas (4), desagrupar (queda en 2 grupos) y rechazo del cuarto nivel. Sin errores de página
- **No se probó**: con el **servidor real y varios jugadores** (en este entorno no había red para `npm install` y no se pudo instalar `ws`), ni el aspecto o la colisión de una casa con subgrupos, ni una puerta hecha con un subgrupo (su animación), ni la interfaz en celular
- **Límites**: los modelos `.glb` siguen sin poder ir dentro de un grupo (el servidor solo los admite sueltos); las reglas solo en el primer nivel; las plantillas propias aplanan los grupos (guardan las formas sueltas, sin la estructura de subgrupos); los permisos solo se aplican al objeto de primer nivel
- **Aviso sobre este README**: los puntos de «amigos», «lugares guardados» y «ciclo de día y noche» del punto 13 ya existen en el código (lista de amigos, mensajes privados, ir junto a un amigo, lugares guardados y hora del día con ciclo automático); falta revisar qué queda de ese punto
- **Siguiente sugerido**: 14 (economía, voz y publicar en internet), 12 (LOD y medir rendimiento) o los hallazgos 3 y 4 del análisis (unificar límites de tamaño y limpiar `uploads/`)

## Estado anterior (v6.27)

- [x] **Plantillas propias, favoritos y recientes en el servidor (punto 16)**: *Mis plantillas*, ⭐ favoritos y los últimos 8 objetos colocados se guardan ahora en el servidor (`world.json`, clave `tpl`), ligados a tu identidad. Con una **cuenta** (ventana *Cuenta*) te siguen a cualquier navegador u ordenador: al iniciar sesión se cargan solas, y un cambio hecho en una pestaña o navegador aparece en los demás con la misma cuenta. Sin cuenta se guardan por el código del navegador, y al *Crear cuenta* desde ese mismo navegador se conservan
- [x] **Primera sincronización sin perder nada**: la primera vez que un navegador se conecta con una identidad que ya tiene datos en el servidor, se **unen** sus plantillas locales con las del servidor (sin repetir ids, hasta 30 plantillas y 100 favoritos). Desde entonces manda el servidor: lo que borras en un sitio se borra en todos. Si el servidor aún no tenía nada, se suben las del navegador. Si el servidor no responde (versión antigua) todo sigue funcionando solo en el navegador
- [x] **Validación y límites en el servidor**: cada plantilla se revisa igual que al importar (formas, colores, materiales, vectores razonables, modelos con nombre `64 hex + .glb`); máx. 30 plantillas de 200 piezas y 10 modelos, 100 favoritos, 8 recientes, unos 900 KB por identidad y 5000 identidades con datos; una escritura cada 300 ms como mucho (el cliente agrupa los cambios en 0,8 s y reintenta). Si el servidor rechaza algo, el aviso lo dice y la copia del navegador se conserva
- [x] Exportar / Importar sigue igual (sirve de copia de seguridad en un archivo)
- [x] Versión del paquete: 6.27.0
- **Qué se probó**: servidor real con jugadores simulados por WebSocket (guardar, leer al entrar, aviso a otra pestaña de la misma identidad, otra identidad sin datos, plantillas inválidas rechazadas: modelo como pieza, id con `../`, modelo con ruta, coordenadas enormes; 31 plantillas rechazadas; límite de ritmo) y **en un Chromium sin interfaz** con el cliente real: subida de las locales a un servidor vacío, unión al conectar desde otro navegador con la misma identidad, actualización en vivo entre dos navegadores al borrar una plantilla y al marcar un favorito, y que tras recargar se adopta lo del servidor. **No se probó** con una cuenta con contraseña iniciando sesión desde otro equipo real, ni con muchas plantillas grandes, ni en celular
- **Límites**: las plantillas con modelos `.glb` guardan solo el nombre del archivo (el modelo debe existir en ese servidor); no hay historial ni papelera (si borras una plantilla en un sitio, desaparece en todos; el respaldo es *Exportar*); si dos navegadores editan a la vez, gana el último en guardar; las miniaturas no se guardan, se vuelven a dibujar; el límite de 900 KB se alcanzaría solo con muchas plantillas de ~200 piezas
- **Siguiente sugerido**: 9 (grupos anidados, que permitiría meter los modelos .glb dentro del grupo de una plantilla) o 13/14 (social, economía y publicar en internet)

## Estado anterior (v6.26)

- [x] **Plantillas propias con modelos .glb (punto 21)**: *Guardar selección como plantilla* ahora admite modelos importados sueltos (hasta 10 por plantilla, junto con las formas). La plantilla guarda para cada modelo el archivo (`src`) y su posición, giro y tamaño relativos al conjunto. Al colocarla se crea el grupo de formas y, a su lado, cada modelo como objeto suelto en su sitio; todo queda seleccionado a la vez para moverlo junto. Se admiten plantillas formadas **solo por modelos**. Al pasar el ratón, el título indica «con N modelo(s) .glb»; la miniatura dibuja cada modelo como una caja gris
- [x] **Exportar / Importar** incluye los modelos; al importar se valida que el nombre de archivo tenga el formato del servidor (64 letras hex + `.glb`), que la posición, el giro y el tamaño sean números razonables (tamaño entre 0 y 100) y el máximo de 10 modelos
- [x] Versión del paquete: 6.26.0
- **Qué se probó**: el script del cliente y `server.js` pasan la comprobación de sintaxis, y la validación de importación (`cleanTpl`) se probó aislada con casos válidos e inválidos (modelo correcto, plantilla solo de modelos, nombre de archivo con `../`, plantilla vacía). **No se probó en navegador** ni con el servidor en marcha (el entorno no tenía red para `npm install`): guardar y colocar una plantilla con modelo, la miniatura, la selección conjunta ni exportar/importar
- **Límites**: los modelos no pueden ir *dentro* del grupo (el servidor solo admite modelos como objetos sueltos), así que al colocar la plantilla son objetos aparte: no se mueven como una sola pieza salvo que sigan seleccionados juntos, y cuentan para el máximo de 30 modelos por jugador. El archivo `.glb` debe existir en el servidor: en otro servidor (o si se borró) el modelo no se coloca y el servidor lo rechaza, aunque las formas sí se crean. Los modelos acoplados al avatar no se guardan. Las reglas de un modelo no viajan con la plantilla
- **Siguiente sugerido**: 16 (plantillas en el servidor, ligadas a la cuenta) o 9 (grupos anidados, que permitiría meter los modelos dentro del grupo)

## Estado anterior (v6.25)

- [x] **Carpetas para *Mis plantillas* (punto 17)**: cada plantilla propia tiene un botón 📁 para ponerle carpeta (texto libre, hasta 16 letras; vacío = sin carpeta). Sobre la sección aparece un selector con *Todas las carpetas*, *Sin carpeta* y una entrada por carpeta (solo se muestra cuando existe alguna). Al guardar una selección con una carpeta elegida, la plantilla nueva entra en esa carpeta. El buscador también encuentra por nombre de carpeta, y ◂ ▸ mueven la plantilla dentro de la carpeta que estás viendo. La carpeta se guarda en el navegador y viaja en **Exportar / Importar** (se limpia al importar)
- [x] Versión del paquete: 6.25.0
- **Qué se probó**: el script del cliente pasa la comprobación de sintaxis. **No se probó en navegador**: el selector, el botón 📁 (ni su tamaño en celular), el filtrado ni exportar/importar con carpetas
- **Límites**: las carpetas son una sola capa (sin subcarpetas) y se crean escribiendo su nombre; no hay renombrar ni borrar una carpeta en bloque (se vacía cuando ninguna plantilla la usa); las plantillas favoritas/recientes ignoran la carpeta
- **Siguiente sugerido**: 21 (plantillas con modelos .glb) o 16 (plantillas en el servidor, ligadas a la cuenta)

## Estado anterior (v6.24)

- [x] **Controles táctiles más grandes (punto 19)**: en pantallas táctiles (`pointer:coarse`) los botones de cada plantilla de la paleta (✎ renombrar, ✕ borrar, ◂ ▸ ordenar y la estrella ☆) tienen una zona de toque mayor, texto de 18 px y las casillas de la paleta son más altas. En ratón no cambia nada
- [x] **Metal menos oscuro (punto 20)**: el material `metal` pasa de metalicidad 0,9 / rugosidad 0,25 a 0,55 / 0,4, así que farola, lámpara, semáforo, buzón y las piezas metálicas ya no se ven casi negras sin mapa de entorno. No se añadió mapa de entorno: las miniaturas usan otro renderizador y no podrían compartirlo
- [x] **Miniaturas en caché (punto 22)**: las miniaturas de formas y plantillas del catálogo se guardan en el navegador (`localStorage`, clave `mv_th_6.24`) y las siguientes visitas las cargan al instante sin dibujarlas. Las de *Mis plantillas* se siguen generando cada vez (cambian al editarlas). Al cambiar de versión se borra la caché antigua; si el navegador no tiene espacio, se ignora sin errores
- [x] Versión del paquete: 6.24.0
- **Qué se probó**: el script del cliente pasa la comprobación de sintaxis, `server.js` también, y tras `npm install` el servidor arranca y sirve la página con el código nuevo. **No se probó en navegador ni en un celular real**: el tamaño de los botones táctiles, el aspecto del metal ni la velocidad de la caché de miniaturas
- **Siguiente sugerido**: 17 (carpetas para *Mis plantillas*), 21 (plantillas con modelos .glb) o 16 (plantillas en el servidor, ligadas a la cuenta)

## Estado anterior (v6.23)

- [x] **22 plantillas nuevas (99 en total)** en cuatro secciones nuevas de la paleta (punto 18): **Playa** (sombrilla, tumbona, castillo de arena, palmera, chiringuito, red de voleibol, toalla), **Desierto** (cactus, dunas, tienda beduina, oasis, mesa rocosa, camello), **Nieve** (iglú, pino nevado, cabaña nevada, trineo, pista de hielo, montón de nieve) e **Interiores** (baño, sala, oficina). Se buscan por palabras como «playa», «nieve» o «interior» (sin tildes)
- [x] **Arreglo: `package.json` estaba vacío en el zip v6.22** (0 bytes), así que `npm install` fallaba con «Unexpected end of JSON input». Se reconstruyó desde `package-lock.json` y este README (dependencia `ws`, script `start`, Node 18+) y la versión pasa a 6.23.0
- **Qué se probó**: servidor real con un jugador simulado por WebSocket: las 22 plantillas se aceptan (22 de 22) y cada una tiene su botón en la paleta. El script del cliente pasa la comprobación de sintaxis. El recuento real de botones de plantilla es 99 (77 antes de esta versión; el «75» de v6.22 estaba algo bajo)
- **No se probó en navegador**: el aspecto de las plantillas nuevas, las miniaturas ni la orientación de piezas giradas (hoja de la palmera, respaldo de la tumbona, cuello del camello). Conviene revisarlas una a una y retocar con los ejes si alguna sale rara
- **Límites**: son decoración sin puertas ni reglas; el iglú es una cúpula maciza (no se entra); en *Interiores* el baño solo tiene dos paredes para ver dentro; el material `metal` solo se usa en un grifo (punto 20)

## Estado anterior (v6.22)

- [x] **6 plantillas más con puertas (75 en total)**, en *Con puertas que se abren*: **comercio** (puerta de cristal), **edificio**, **laboratorio**, **aula** (con pizarra y 4 pupitres), **gallinero** (puerta pequeña) y **faro** (puerta en la base). Todas son habitaciones huecas con suelo, techo y hueco de puerta, así que se puede entrar. La puerta se desliza hacia un lado al tocarla. Con esto se completa el punto 15
- **Qué se probó**: servidor real con un jugador simulado por WebSocket: las 6 plantillas pasan la validación y tocar la puerta de cada una manda el efecto de movimiento esperado (desplazamiento igual al ancho de la puerta). El script del cliente pasa la comprobación de sintaxis. **No se probó en navegador**: el aspecto, entrar caminando por el hueco ni la animación
- **Límites**: puertas solo correderas; los interiores son sencillos (sin escaleras ni pisos); el edificio y el faro tienen un solo nivel hueco; las plantillas originales sin puerta siguen disponibles

## Estado anterior (v6.21)

- [x] **3 plantillas más con puertas (72 en total)**, en *Con puertas que se abren*: **granero con portón** (el portón se desliza), **hospital con puerta** (puerta doble de cristal que se abre hacia los lados) e **iglesia con puerta** (puerta de madera corredera). A diferencia de las plantillas decorativas, tienen paredes con hueco real y suelo, así que se puede entrar caminando. Las originales (granero, hospital, iglesia) siguen en su sitio, sin puerta
- **Qué se probó**: servidor real con un jugador simulado por WebSocket: las 3 plantillas pasan la validación y se aceptan; tocar la puerta de cada una manda el efecto de movimiento esperado (`1.9`, `2.11`, `3.13`). El script del cliente pasa la comprobación de sintaxis. **No se probó en navegador**: el aspecto de las plantillas, que el avatar entre por el hueco, ni la animación de las puertas
- **Límites**: las puertas son correderas (no giran sobre bisagra); el interior está vacío; tocar dos puertas seguidas en menos de 300 ms solo registra la primera (límite del servidor por jugador)

## Estado anterior (v6.20)

- [x] **Editor de reglas por pieza**: al seleccionar un grupo, la pestaña *Caract.* muestra un selector **Pieza del grupo** («Todo el grupo» o «Pieza n · tipo color · n reglas»). Al elegir una pieza se resalta con un brillo suave y todo el editor (plantillas de reglas, añadir regla, *Probar (tocar)*) trabaja sobre esa pieza. Así puedes hacer que cualquier puerta o ventana de un grupo tuyo se abra, no solo las de las plantillas. Se guarda con el grupo (`save()`), y necesita el permiso *modificar*, igual que las reglas de un objeto suelto
- [x] **Pieza recién agrupada**: el índice de una pieza (para el efecto y para tocarla) se calcula por su posición en el grupo cuando aún no tiene índice del servidor
- **Qué se probó**: servidor real con jugadores simulados: dar reglas a una pieza con una edición (`upd`) funciona y tocarla manda el efecto `id.1`; quitarlas descarta el estado en ejecución (el cliente recibe la limpieza) y tocar ya no hace nada; 41 piezas con reglas de un mismo jugador se rechazan (límite de 40) y 40 se aceptan. **No se probó en navegador** el selector, el resaltado de la pieza ni el flujo completo de agrupar y poner una regla
- **Límites**: las piezas se identifican por número (no hay nombres ni forma de elegir una pieza haciendo clic en ella); el resaltado usa el brillo del material y puede no verse en materiales luminosos; las piezas nuevas de un grupo editado se numeran al final

## Estado anterior (v6.19)

- [x] **Reglas dentro de grupos (pendiente 10 y 15)**: una pieza de un grupo puede llevar sus propias reglas (hasta 8, como un objeto suelto). Cada pieza tiene su estado en el servidor (clave `id.índice`), así que la puerta de una casa se abre sin mover el resto. Funcionan *Al tocar*, *Cada cierto tiempo*, *Al acercarse* y *Al empezar*; el sensor usa la posición real de la pieza dentro del grupo. Cada pieza con reglas cuenta para los límites (200 por mundo, 40 por jugador). Las reglas viajan con el grupo al duplicarlo, regalarlo, guardarlo en el inventario o en *Mis plantillas*
- [x] **3 plantillas con puertas (69 en total)**, sección *Con puertas que se abren*: **casa con puerta** (puerta corredera y dos persianas que se ocultan al tocarlas), **garaje con portón** (el portón sube) y **valla con portón** (la hoja se desliza). Se puede entrar en la casa y el garaje
- [x] **Colisiones por pieza en grupos con puertas**: solo los grupos que llevan piezas con reglas colisionan pieza a pieza (los demás siguen como una sola caja). Además las colisiones ya no calculan los objetos que están a más de 8 m del avatar, lo que también aligera el cliente
- **Cómo se usa**: pulsa la puerta con clic corto. Con tus propios objetos hay que marcar la casilla de prueba de *Reglas* (*Probar «Al tocar» en mis objetos*), como siempre; otros jugadores la tocan sin eso. Las puertas se mueven en sentido del eje del grupo (si giras la casa, la puerta gira con ella)
- **Qué se probó**: servidor real con jugadores simulados por WebSocket: las reglas de una pieza se guardan; *Al empezar* oculta la pieza; tocar la pieza 1 manda el efecto `1.1` solo a quien tiene el objeto, tocarla otra vez la cierra, y tocar una pieza sin reglas no hace nada; un jugador que entra después recibe el estado de las piezas. Las 3 plantillas nuevas pasan la validación del servidor. **No se probó en navegador**: la animación de la puerta, el clic sobre la pieza, entrar caminando por la puerta ni el aspecto de las plantillas
- **Límites**: no hay editor para las reglas de una pieza (hoy solo vienen en las plantillas y se conservan al editar); *Girar* rota la pieza sobre su propio centro, no sobre una bisagra (por eso las puertas son correderas); *Mover* se mide en el espacio del grupo; la pieza oculta con *Al empezar* se ve en su estado base mientras está seleccionado el grupo

## Estado anterior (v6.18)

- [x] **Envío solo de lo cercano (pendiente 12, parte del servidor)**: cada jugador recibe únicamente los objetos a menos de 170 m (contando el tamaño del objeto) y el servidor se los quita a partir de 200 m. Al caminar más de 12 m, el servidor envía los que entran en rango y avisa de los que salen (mensaje `items`). `add`, `upd`, `del` y los efectos de las reglas solo se difunden a quien tiene ese objeto o debería tenerlo. Siempre se envían tus objetos y los acoplados al avatar
- **Efectos que se notan**: el contador de objetos del cliente cuenta solo lo cercano; *Ajustes → Rendimiento* dirá «Dibujando X de Y» con Y = lo recibido. Exportar y vaciar siguen funcionando porque tus objetos se reciben siempre. Los sensores y temporizadores de las reglas siguen corriendo en el servidor con todo el mundo
- **Qué se probó**: servidor real con dos jugadores simulados por WebSocket (objetos en x = 0, 300, −400, 295 y 600): al entrar solo llega el cercano; al caminar a x = 290 llega el de 300 y se olvida el de 0; un objeto nuevo en 600 no se envía y uno en 295 sí. **No se probó en navegador**, ni con varios jugadores reales, ni con miles de objetos (sin medir tráfico ni fotogramas)
- **Límites**: el radio es fijo (no depende de la niebla del ambiente); un objeto enorme solo se considera por su centro más su tamaño estimado; no hay simplificación (LOD) de objetos medianos

## Estado anterior (v6.17)

- [x] **Rendimiento en el cliente (pendiente 12, primera parte)**: en *Ajustes → Rendimiento*, la casilla *Ocultar lo que está muy lejos* (activada) deja de dibujar los objetos que quedan más allá de la niebla (+15 m), midiendo desde la cámara y desde tu avatar. Muestra «Dibujando X de Y objetos». Se hace con capas de Three.js (`layers`), sin tocar `.visible`, así que las reglas y las colisiones no se ven afectadas; los objetos seleccionados nunca se ocultan. Se revisa 4 veces por segundo y con histéresis de 10 m para que no parpadeen
- **Falta del pendiente 12 (servidor)**: `init` y las difusiones (`add`, `upd`, `del`) siguen enviando todos los objetos del mundo a cada jugador; el ahorro de red y de memoria llegará al enviar solo lo cercano. Tampoco hay simplificación (LOD) de objetos lejanos
- **Qué se probó**: el script del cliente pasa la comprobación de sintaxis y el servidor arranca y sirve la página con el control nuevo. **No se probó en un navegador** con muchos objetos (ni la medida de fotogramas por segundo), así que el beneficio real está sin medir

## Estado anterior (v6.16)

- [x] El README ahora recoge lo que falta: ver la sección **Pendiente → Catálogo de objetos y plantillas** (puntos 15 a 22) y qué se probó y qué no

## Estado anterior (v6.15)

- [x] **Ordenar tus plantillas propias**: cada una tiene ◂ ▸ para moverla antes o después; el orden se conserva al recargar y al exportar
- Recordatorio: para colocar varias copias seguidas basta con dejar marcada la casilla «Mantener la herramienta seleccionada» (viene activada) y pulsar varias veces en el mundo

## Estado anterior (v6.14)

- [x] **7 plantillas de granja** (66 en total) en *Granja*: granero, silo, tractor, corral (cerca cuadrada con comedero y paja), gallinero con gallina, espantapájaros y fardo de paja

## Estado anterior (v6.13)

- [x] **5 plantillas de ciudad** (59 en total) en *Ciudad y servicios*: hospital, comercio, cruce de calles, parada de bus e iglesia
- [x] **Exportar/Importar incluye tus favoritos** (los favoritos que apuntan a plantillas propias no se transfieren, porque cambian de identificador al importarlas)

## Estado anterior (v6.12)

- [x] **Renombrar plantillas propias** con el ✎ de cada una
- [x] **Exportar / Importar** tus plantillas (botones ⬇ ⬆ bajo «Guardar selección»): descarga `mis-plantillas.json` y cárgalo en otro navegador u ordenador, o compártelo con otras personas. Al importar se validan las piezas y se omiten las inválidas (límite total: 30 plantillas)

## Estado anterior (v6.11)

- [x] **Favoritos**: pulsa la ☆ de cualquier forma, plantilla o plantilla propia y aparece en la sección ⭐ *Favoritos* al inicio de la paleta (se guardan en el navegador)
- [x] El aviso «Pulsa en el mundo para construir: …» ya no incluye símbolos sobrantes (✕, ☆)

## Estado anterior (v6.10)

- [x] **8 plantillas nuevas** (54 en total) en la categoría *Casas y escenas*: cocina, dormitorio completo, puesto de mercado, edificio, molino, faro, jardinera y arco de entrada
- [x] La bicicleta se rehízo con un cuadro más grueso

## Estado anterior (v6.9)

- [x] **14 plantillas nuevas** (46 en total): *Vehículos* (coche, bus escolar, barco, avión, bicicleta) y *Escuela y parque* (pupitre, pizarra, aula completa, laboratorio, escenario, tobogán, subibaja, arenero, kiosco)
- [x] **Recientes**: una fila al inicio de la paleta con los últimos 8 objetos que colocaste (se recuerdan en el navegador)

## Estado anterior (v6.8)

- [x] **Miniaturas en la paleta**: cada forma y plantilla muestra un dibujo pequeño (se generan al abrir *Crear*, en unos segundos)
- [x] **Mis plantillas**: selecciona uno o más objetos (Mayús+clic para varios) y pulsa **💾 Guardar selección como plantilla**. Quedan en la sección *Mis plantillas* (máx. 30, hasta 200 piezas cada una), se colocan como las demás y se borran con la ✕. Se guardan en el navegador (`localStorage`), no en el servidor: no pasan a otro navegador ni a otras personas. Los modelos importados (.glb) no se pueden incluir

## Estado anterior (v6.7)

- [x] **Arreglo: la ventana Construir mostraba solo las herramientas, sin objetos**: el panel *Crear* estaba etiquetado `crear` y la herramienta se llama `create`, así que nunca se abría. Ahora aparece al pulsar **Crear**
- [x] **Arreglo: las plantillas no se podían colocar**: su posición se calculaba como `[x, z]` en lugar de `[x, y, z]`, el servidor la rechazaba («No se pudo crear el objeto»). Ahora se colocan donde pulsas, incluso encima de otros objetos
- [x] **Catálogo ampliado**: 29 formas (10 nuevas: disco, octaprisma, pentaprisma, anillo, estrella, corazón, cruz, muro en L, nudo y resorte) y **32 plantillas** (26 nuevas) agrupadas por categoría: Naturaleza, Edificios, Muebles y Ciudad y juegos
- [x] **Buscador y filtros** en la ventana Construir: escribe «cama», «arbol» o «piramide» (sin tildes) y filtra por *Todo / Formas / Plantillas*. La ventana es más alta en la pestaña Crear y se desplaza con la rueda
- [x] El servidor admite los nuevos tipos de forma (`TYPES`) y los nombra bien en el inventario

## Estado anterior (v6.6)

- [x] **Cuentas con contraseña (v6.6)**: ventana *Cuenta*. *Crear cuenta* convierte tu identidad actual (objetos, inventario, amigos, parcelas) en una cuenta con nombre y contraseña; *Iniciar sesión* en otro navegador te da la misma identidad. Las contraseñas se guardan con scrypt y sal propia (nunca en claro). Nombre: 3 a 20 caracteres; contraseña: 6 a 64. Máximo 10 sesiones por cuenta; cambiar la contraseña cierra las demás
- [x] **Protección (v6.6)**: tras 5 intentos fallidos desde una misma dirección, el servidor bloquea los intentos 10 minutos. Un visitante no puede usar el nombre de una cuenta (se le añade « (visit.)»)
- [x] **Administrador (v6.6)**: la **primera cuenta creada en el servidor** es administradora (crea la tuya antes de abrirlo a otros). Puede devolver objetos de cualquiera, configurar o liberar cualquier parcela, eliminar mundos (menos el principal) y nombrar o quitar administradores (siempre queda al menos uno)
- Límites: no hay recuperación de contraseña ni borrado de cuentas. Sin HTTPS la contraseña viaja sin cifrar por el WebSocket: para internet, ponlo detrás de HTTPS (wss). Quien ya tenía objetos como visitante debe crear la cuenta **desde ese mismo navegador** para conservarlos

## Estado anterior (v6.5)

- [x] **Amigos (v6.5)**: ventana *Amigos*. Se invita a un jugador conectado de tu mundo y debe aceptar (si los dos os invitáis, queda aceptado). La lista (hasta 100) se guarda en `world.json` (clave `friends`), muestra quién está conectado y en qué mundo, y se actualiza sola cuando alguien entra o sale. *Quitar amigo* lo borra en ambos lados
- [x] **Mensajes privados (v6.5)**: a un amigo conectado (esté en el mundo que esté) o a cualquier jugador de tu mismo mundo. Aparecen en el *Chat* en color de acento como «(privado)». No se guardan: si el otro no está conectado, no se envía
- [x] **Ir con un amigo (v6.5)**: te lleva junto a un amigo conectado que esté en tu mismo mundo; si está en otro, te dice cuál. Ser amigo equivale a dar ese permiso
- Límite: las invitaciones pendientes viven en memoria y se pierden al reiniciar el servidor. Como no hay cuentas, la amistad va ligada al código del navegador

## Estado anterior (v6.4)

- [x] **Nombre y descripción (v6.4)**: pestaña *General*. Se guardan en el servidor, viajan al inventario y al regalar, y cambiarlos exige el permiso *modificar*. Además se muestra el propietario
- [x] **Hora del día (v6.4)**: en *Ajustes*, hora manual o ciclo automático (1 día = 10 min). Solo cambia tu pantalla; el ambiente *noche* no se toca
- [x] **Lugares guardados (v6.4)**: en *Ajustes*, guarda donde estás y vuelve con *Ir* (por mundo, en tu navegador)

## Estado anterior (v6.3)

- [x] **Ventana Construir unificada (v6.3)**, como el constructor de Second Life: barra de herramientas (*Enfocar, Mover, Girar, Escalar, Crear, Terreno*), línea de ayuda, selección con su «impacto en el terreno» y cinco pestañas: *General* (creador, permisos y regalar), *Objeto* (posición, giro, tamaño, agrupar, duplicar, borrar, acoplar), *Caract.* (reglas), *Textura* (color, material, imagen propia) y *Contenido* (inventario). Las ventanas *Parcelas*, *Reglas* e *Inventario* desaparecen del dock y viven aquí
- [x] **Crear pulsando en el mundo (v6.3)**: elige una forma o plantilla y pulsa en el suelo (o sobre un objeto) para colocarla ahí; *Crear junto a mí* la coloca cerca. Opciones: mantener la herramienta, *Copiar la selección* (pulsar en el mundo copia lo seleccionado), copia centrada y copia girada
- Cuadrícula, ejes (mundo/locales), deshacer y rehacer están en la barra de las herramientas de edición

## Estado anterior (v6.2)

- [x] **Reglas (v6.2)**: ventana *Reglas* (botón del dock). Cada objeto puede llevar hasta 8 reglas del tipo **evento → acciones** (hasta 6 acciones por regla), guardadas como datos JSON en el propio objeto (`rules`). No hay código libre: el servidor valida cada regla, la ejecuta y avisa a todos. Pensado como el equivalente seguro de los scripts LSL de OpenSim
- [x] **Eventos (v6.2)**: *Al tocar* (clic corto de cualquier jugador, a 15 m como máximo; en tus propios objetos solo si marcas la casilla de prueba, para no activarlos al seleccionar), *Cada cierto tiempo* (temporizador, **mínimo 1 s**), *Al acercarse alguien* (sensor de 1 a 20 m; salta una vez cada vez que alguien entra en el radio) y *Al empezar* (al colocar el objeto, al cambiar sus reglas y cuando el mundo se activa)
- [x] **Acciones (v6.2)**: *Mover* y *Girar* hacia un punto (desplazamiento o giro relativo al objeto, con duración y opción **alternar** para ir y volver, como una puerta), *Visibilidad* (mostrar, ocultar, alternar; lo oculto no bloquea el paso), *Color*, *Decir en el chat* (lo oye quien esté a menos de 20 m, como `llSay`), *Teletransportar* (solo a quien toca o se acerca) y *Restablecer*
- [x] **Plantillas de reglas (v6.2)**: puerta corredera, plataforma que sube y baja, luz intermitente, cartel que habla, portal, se pone rojo y aparece al acercarse. Se añaden con un clic y se ajustan en los campos
- [x] **Quién ejecuta qué (v6.2)**: las reglas las define el dueño (hace falta el permiso *modificar*, igual que cambiar el color) y las ve y activa cualquier jugador. Viajan con el objeto al regalarlo, guardarlo en el inventario o duplicarlo. Los objetos acoplados al avatar no ejecutan reglas
- [x] **Límites y protección (v6.2)**: 200 objetos con reglas por mundo y 40 por jugador; el servidor limita los efectos a 80 por segundo y mundo (frena bucles), el teletransporte tiene una pausa de 2 s por jugador (evita rebotes entre portales) y el temporizador no baja de 1 s
- [x] **Estado en ejecución (v6.2)**: puertas abiertas, colores y visibilidad viven en el servidor mientras haya alguien en el mundo y **no se guardan** en `world.json`. Al quedarse el mundo vacío se descartan y, al volver a entrar, todo parte del estado original y se lanza *Al empezar*. Con el mundo vacío no corren temporizadores. Lo que se guarda y exporta es la posición **base** del objeto, nunca el desplazamiento animado
- [x] **Edición (v6.2)**: un objeto seleccionado se muestra siempre en su posición base (aunque su regla lo tenga movido) para poder editarlo; al soltarlo vuelve a mostrarse en su estado actual. Las animaciones siguen el reloj real aunque el equipo vaya lento

## Estado anterior (v6.1)

- [x] **Parcelas (v6.1)**: ventana *Parcelas* (botón del dock). *Reclamar aquí* crea un cuadrado de 8, 16 o 32 m centrado en tu avatar, siempre que no se solape con otra parcela. Cada jugador puede tener hasta 3 por mundo, de 4 a 32 m por lado, y hasta 100 por mundo. Se ven en el suelo: verde las tuyas, azul las abiertas a todos y naranja las protegidas de otros
- [x] **Control de construcción (v6.1)**: en una parcela protegida solo su dueño puede crear, colocar desde el inventario o mover objetos hacia dentro. El dueño elige *construir: solo yo / cualquiera* y un **máximo de objetos** (1 a 500, por defecto 100) que cuenta a todos, también a él. Los objetos que ya estaban dentro al reclamarla se quedan, y moverlos dentro de la misma parcela siempre se permite
- [x] **Devolver objetos en tu parcela (v6.1)**: el dueño de una parcela puede devolver (borrar) cualquier objeto ajeno que esté dentro, igual que quien creó el mundo (clic y `Mayús+Supr`). Quien creó el mundo también puede configurar o liberar cualquier parcela
- [x] **Información (v6.1)**: la ventana muestra en qué parcela estás, de quién es, el modo de construcción y cuántos objetos tiene sobre su máximo. Las parcelas se guardan en `world.json` dentro de cada mundo y se migra solo; los mundos antiguos empiezan sin parcelas

## Estado anterior (v6.0)

- [x] **Inventario personal (v6.0)**: ventana *Inventario* (botón del dock). *Guardar selección* quita del mundo tus objetos seleccionados y los guarda con su creador y sus permisos; *Colocar* los pone en el mundo en el que estés (el inventario es el mismo en todos los mundos), con *Nombre* para renombrarlos y *Borrar* para eliminarlos. Es el equivalente a «tomar» y «soltar» de OpenSim
- [x] **Permisos en el inventario (v6.0)**: un objeto con permiso de copia sigue en el inventario al colocarlo, así que puedes colocarlo varias veces; uno sin copia sale del inventario al colocarlo (como en Second Life). Lo regalado sin copia puede guardarse y colocarse, pero nunca multiplicarse
- [x] **Datos (v6.0)**: cada jugador puede guardar hasta 200 objetos. Los inventarios se guardan en `world.json` (clave `inv`), por identidad del navegador. Los modelos importados se colocan solo si su archivo sigue en `uploads/`
- [x] **Colocar y deshacer (v6.0)**: colocar un objeto queda en el historial, y deshacer lo borra del mundo. Si lo rehaces vuelve con sus permisos; si no, un objeto sin copia se pierde, igual que cualquier borrado

## Estado anterior (v5.9)

- [x] **Permisos tipo OpenSim (v5.9)**: cada objeto lleva tres permisos, *copiar*, *modificar* y *transferir*, como las máscaras de OpenSimulator. Hay dos juegos: los del **dueño actual** (`cur`) y los que tendrá el **siguiente dueño** (`next`). El creador queda registrado para siempre. Nadie puede dar más permisos de los que tiene
- [x] **Panel Permisos (v5.9)**: en *Construir → Objeto* muestra el creador y lo que puedes hacer, tres casillas para elegir qué podrá hacer el siguiente dueño y un botón **Regalar** con la lista de jugadores del mundo. Al regalar, el nuevo dueño recibe como permisos actuales los de «siguiente dueño» y el objeto se suelta del avatar si estaba acoplado
- [x] **Reglas aplicadas por el servidor (v5.9)**: sin *copiar* no se duplica ni se restaura con deshacer una copia; sin *modificar* solo se puede mover, girar o acoplar (tamaño, color, material, textura y piezas quedan fijos); sin *transferir* no se puede regalar. Si el servidor rechaza un cambio, el objeto vuelve a su estado real y aparece un aviso. Agrupar y desagrupar objetos con permisos restringidos está bloqueado
- [x] **Devolver objetos (v5.9)**: quien creó un mundo puede devolver objetos ajenos de ese mundo (clic en el objeto y `Mayús+Supr`), como el «devolver objeto» de las fincas de OpenSim
- [x] **Deshacer seguro (v5.9)**: al deshacer el borrado de un objeto, el servidor guarda lo borrado por jugador y lo restaura una sola vez, conservando creador y permisos (antes volvía como objeto nuevo con todos los permisos)
- [x] **Guardado atómico (v5.9)**: `world.json` se escribe en un archivo temporal y se renombra, así un corte de luz o un cierre brusco ya no lo deja a medias; también se guarda al recibir `SIGTERM`
- **Migración**: los objetos de versiones anteriores reciben al arrancar creador = dueño y todos los permisos. No hace falta tocar `world.json`

## Estado anterior (v5.8)

- [x] **Varios mundos (v5.8)**: ventana *Mundos* (botón inferior izquierdo, que muestra el mundo actual). Lista todos los mundos con jugadores, objetos y ambiente, y permite cambiar de uno a otro, crear uno nuevo (nombre + ambiente) y copiar su enlace. Cada mundo tiene sus propios objetos, jugadores y chat; los archivos subidos (modelos e imágenes) son comunes. El enlace de cada mundo es `http://localhost:3001/#nombre-del-mundo`. Solo su creador puede eliminarlo (los jugadores que estén dentro pasan al principal); el *Mundo principal* no se puede borrar. Límite: 5 mundos por usuario y 50 en total
- [x] **Ambientes (v5.8)**: pradera, desierto, nieve, noche y marte (cielo, suelo, cuadrícula, niebla y luz)
- [x] **12 formas nuevas (v5.8)**: prisma, tronco, cápsula, cúpula, tubo, rampa, escalera, arco, tetraedro, octaedro, icosaedro y dodecaedro. Se colorean, texturizan y editan como las demás
- [x] **Plantillas (v5.8)**: árbol, casa, mesa, silla, farola y torre, que se crean como grupos ya hechos y se pueden editar o desagrupar
- [x] **Aparición en espiral (v5.8)**: los objetos nuevos ya no se apilan en el mismo punto, y al crear varios seguidos la ventana *Construir* se queda en la pestaña *Crear*
- **Migración**: al arrancar, un `world.json` de versiones anteriores se convierte solo: sus objetos pasan al *Mundo principal*. Conviene hacer una copia del archivo antes de actualizar, porque el formato nuevo no lo leen las versiones anteriores

## Estado anterior (v5.7)

- [x] **Interfaz con ventanas flotantes (v5.7)**, al estilo Second Life: desaparecen los paneles fijos y el mundo ocupa toda la pantalla. Todo está en ventanas translúcidas que arrastras por la barra de título, redimensionas desde la esquina inferior derecha, minimizas (botón o doble clic en la barra) y cierras. La ventana activa se resalta y pasa al frente
- [x] **Ventana Construir (tecla `B`)**: herramientas (mover, girar, escalar, ejes, deshacer, rehacer) y tres pestañas: *Crear* (formas e importar modelo), *Objeto* (posición, giro, tamaño, agrupar, duplicar, borrar, acoplar) y *Aspecto* (color, material, textura e imagen propia). Al seleccionar un objeto salta sola a la pestaña *Objeto* y muestra qué has seleccionado
- [x] **Otras ventanas**: *Mundo* (cámara, cuadrícula, vaciar), *Mi avatar* (gestos y aspecto), *Chat* (`Enter` lo abre y escribe; el botón se ilumina si llega un mensaje con la ventana cerrada), *Datos* (importar/exportar JSON) y *Ayuda*
- [x] **Barra inferior** para abrir o cerrar cada ventana. La posición, el estado abierto/minimizado de cada ventana se recuerda en tu navegador. En móvil las ventanas se centran y se ajustan al ancho de la pantalla

## Estado anterior (v5.6)

- [x] **Avatar y objetos a la vez (v5.6)**: ya no hay un «modo caminar» que bloquee la edición. Mueves el avatar con `W A S D` o las flechas (`Mayús` corre, `Espacio` salta; desde la v6.44 `E` vuela y `C` baja) y, al mismo tiempo, seleccionas y mueves objetos con el ratón, los ejes o el inspector. El botón *Cámara sigue al avatar* (activado por defecto) solo decide si la cámara acompaña al avatar mientras camina; con el avatar quieto la cámara es libre. Al pulsar `Enter` o `Esc` en un campo del inspector se devuelve el teclado al avatar
- [x] **Aviso en objetos ajenos (v5.6)**: si haces clic en un objeto de otro jugador, el mensaje inferior explica que solo su dueño puede moverlo
- [x] **Importar modelos glTF (v5.6)**: botón *Importar modelo…* (archivos `.glb`, máx. 8 MB). El modelo se ajusta a 1 de tamaño y se apoya en el suelo; luego se mueve, gira y escala con los ejes. Lo ven todos los jugadores y se guarda con el mundo. Se admite acoplarlo al avatar como accesorio
- [x] **Texturas con imágenes propias (v5.6)**: selecciona una forma y pulsa *Subir imagen como textura…* (PNG, JPG o WebP, máx. 2 MB y 4096 px). La textura se sincroniza con los demás y se combina con el color del objeto
- [x] **Subidas seguras (v5.6)**: el servidor comprueba el contenido real del archivo (no la extensión), rechaza GLB con enlaces externos, compresión Draco/Meshopt/Basis o más de 200 000 vértices, guarda los archivos por huella SHA-256 (sin duplicados) en `uploads/` y aplica cuotas: 40 archivos y 60 MB por usuario, 30 modelos por usuario y 1 GB en total

## Estado anterior (v5.5)

- [x] **Personalización del avatar (v5.5)**: en el panel izquierdo, *Mi avatar*: altura (0,8–1,25×), complexión (0,85–1,2×), color principal y color de detalles. Los demás te ven con tu aspecto en tiempo real, se guarda en tu navegador y el servidor valida los límites. «Restablecer avatar» vuelve al aspecto original. La altura también ajusta la cámara, la colisión con objetos altos y la etiqueta con el nombre

## Estado anterior (v5.4.1)

- [x] **Corrección (v5.4.1)**: tras escribir en el chat, el campo conservaba el foco y bloqueaba las flechas y WASD del avatar. Ahora el chat suelta el foco al enviar (Enter) o con Escape, y al entrar en modo caminar o hacer clic en el mundo se libera cualquier foco. Además se limpian las teclas pulsadas si la ventana pierde el foco (evita que el avatar siga caminando solo) y las flechas ya no desplazan la página

- [x] Mundo 3D con suelo, cuadrícula, luces y sombras
- [x] Formas: cubo, esfera, cilindro, cono, pirámide, toro, plano
- [x] Seleccionar y arrastrar; ajuste a cuadrícula; posición, giro y tamaño
- [x] Color, materiales (mate, metal, brillante, vidrio, luminoso) y texturas procedurales
- [x] Duplicar y borrar (`Ctrl+D`, `Supr`, `R` gira)
- [x] Selección múltiple (`Mayús`+clic) y agrupar/desagrupar
- [x] Avatar con modo caminar, salto y colisiones (v4)
- [x] **Servidor multijugador (v5)**: todos ven los objetos y avatares de los demás en tiempo real, con nombre sobre el avatar
- [x] **Chat**
- [x] **Mundo persistente** en el servidor
- [x] **Propiedad básica**: cada objeto tiene dueño; solo el dueño puede editarlo o borrarlo. El dueño se identifica con un código guardado en su navegador (si lo borras, pierdes la propiedad de tus objetos)
- [x] Importar JSON: los objetos se añaden como tuyos
- [x] **Ejes de edición con el ratón (v5.2)**: flechas para mover (también en altura), anillos para girar y cubos para escalar. Teclas `1` mover, `2` girar, `3` escalar, `Q` ejes de mundo/locales, `F` enfocar la selección
- [x] **Deshacer y rehacer (v5.2)**: `Ctrl/Cmd+Z` y `Ctrl/Cmd+Mayús+Z` (o `Ctrl+Y`), hasta 100 pasos, sincronizado con el servidor
- [x] **Copiar arrastrando (v5.2)**: mantén `Alt` (Opción en Mac) al arrastrar un eje
- [x] **Avatar glTF con esqueleto y animaciones (v5.3)**: todos los jugadores usan el mismo modelo y esqueleto (`models/avatar.glb`) con reposo, caminar, correr (`Mayús`) y saltar. Cada jugador tiene su color, y los demás ven su animación en tiempo real
- [x] **Accesorios (v5.4)**: selecciona un objeto o grupo y elige *Acoplar a la cabeza* o *a la mano* en el inspector. Se mueve con el avatar y con sus animaciones, y los demás lo ven puesto. La posición, el giro y el tamaño pasan a ser relativos al avatar (en metros) y se ajustan con los ejes. Elegir *en el mundo* lo suelta donde está. Los accesorios no bloquean el paso
- [x] **Gestos (v5.3)**: Saludar, Bailar y Pulgar arriba, visibles para todos (se cancelan al moverte)
- [x] **Selección múltiple completa (v5.2)**: mover, girar y escalar varios objetos a la vez con un solo gizmo, y cambiar color, material y textura de toda la selección o de un grupo

## Límites y notas

- **Permisos (v5.9):** el servidor hace cumplir copiar, modificar y transferir al editar, duplicar con `from`, regalar y deshacer. Lo que no puede vigilar todavía es el contenido: un cliente manipulado podría volver a crear desde cero la forma de un objeto sin copia (sin `from`) o agruparlo para «limpiar» sus permisos. El navegador lo bloquea, pero hasta que haya cuentas e inventario con huellas de contenido no es una garantía fuerte. Los permisos no se aplican a los objetos de un mismo grupo (solo al objeto de primer nivel)
- **Parcelas (v6.1):** son rectángulos alineados con los ejes, sin altura ni venta ni subdivisión, y no hay alquiler ni límite por parcela de scripts. Cuenta la posición del objeto de primer nivel (su centro), no su tamaño: un objeto grande puede sobresalir. Los accesorios acoplados al avatar no cuentan. En el *Mundo principal* nadie es «dueño del mundo», así que allí solo mandan los dueños de cada parcela
- **Reglas (v6.2):** solo el objeto de primer nivel puede tener reglas (no las piezas dentro de un grupo). *Mover* y *Girar* son relativos al objeto y *Girar* suma ángulos (pensado para giros de un solo eje); no hay giro continuo. Las acciones de varios jugadores a la vez comparten un único estado por objeto (el último gana). Cada jugador ve la animación según su reloj, así que dos pantallas pueden ir unas décimas desfasadas. Un objeto con reglas que se mueve no cambia el punto del sensor (usa su posición base). *Teletransportar* no comprueba parcelas ni zonas protegidas. Con el servidor reiniciado el mundo parte de cero en cuanto entra alguien
- Aún no existe «cualquiera puede mover o editar», ni vender; guardar en el inventario un grupo de objetos lo guarda como una sola pieza; los objetos de otros siguen sin poder seleccionarse

- **Modelos importados:** son estáticos (no se reproducen sus animaciones), no se pueden agrupar ni desagrupar y su color/material no se edita (conservan los suyos). Los GLB deben llevar todo incrustado: se rechazan los que enlazan archivos externos o usan compresión Draco, Meshopt o Basis.
- **Archivos subidos:** si ningún objeto, inventario, plantilla o papelera los usa, se borran solos tras 7 días (v6.29, ver `GC_DAYS`). Para empezar de cero borra `world.json` y la carpeta `uploads/` con el servidor detenido.
- **Importar JSON:** los objetos con modelos o imágenes solo se importan si esos archivos existen en este servidor.
- **Objetos que «no se pueden mover»:** solo mueves los tuyos. Tu identidad es un código guardado en el navegador *por dirección*: `localhost:3001` y `127.0.0.1:3001` (o la IP de la red) son identidades distintas, y una ventana privada o borrar los datos del navegador también te da una nueva. Usa siempre la misma dirección.

- La complexión estira el avatar en ancho; los accesorios acoplados escalan con él y, con valores extremos, pueden verse algo deformados.
- El color principal tiñe el material `Main` del modelo y el de detalles el material `Grey`; los materiales de otro avatar con otros nombres no se teñirían.
- Los accesorios solo se ven mientras su dueño está conectado. Si se desconecta, desaparecen del mundo y vuelven cuando regresa. Un objeto acoplado no se puede duplicar ni desagrupar: suéltalo antes en el mundo.
- Los accesorios usan los huesos `Head_1` (cabeza) y `Palm2R` (mano derecha) del modelo; si cambias de avatar, ajusta `BONES` en `index.html`.

- Para cambiar de avatar, sustituye `models/avatar.glb` por otro glTF/GLB con esqueleto y animaciones llamadas `Idle`, `Walking`, `Running` y `Jump` (y opcionalmente `Wave`, `Dance`, `ThumbsUp`). El material llamado `Main` se tiñe con el color de cada jugador.
- Créditos: el modelo es *RobotExpressive* (Tomás Laulhé, modificado por Don McCurdy), licencia CC0, incluido en los ejemplos de Three.js.
- No hay cuentas ni contraseñas: el código del navegador es la única identidad.
- Los cambios de otros jugadores se ven al soltar el objeto, no mientras lo arrastran.
- El tamaño de los objetos se limita entre 0,01 y 100 (igual en cliente y servidor).
- Deshacer solo afecta a tus objetos; si deshaces el borrado de un objeto, vuelve con un identificador nuevo.
- Máximo 500 objetos por usuario y 5000 por mundo.
- Los objetos de otros no se pueden seleccionar, pero sí bloquean el paso.
- Las colisiones usan cajas envolventes, así que los objetos girados o curvos colisionan como una caja.

## Análisis de mejoras (OpenSimulator 0.9.3.0 como referencia)

**Qué se revisó.** El `opensim.zip` es OpenSimulator 0.9.3.0 ya compilado (.NET 8, sin código fuente). No se ejecutó (el entorno de análisis no tenía .NET): se leyeron sus archivos de configuración (`OpenSimDefaults.ini`, `Standalone.ini`) y su lista de eventos LSL (`ScriptSyntax.xml`). No se ha copiado código ni binarios: se usa como **modelo de diseño**. El zip no incluye ningún `.oar` de ejemplo.

**Por qué no se integra tal cual.** OpenSim habla con visores de escritorio (Firestorm) por UDP y con formatos de Second Life (texturas JPEG2000, prims, mallas). Nuestro mundo vive en el navegador y usa WebSocket y JSON. Un puente sería meses de trabajo y haría perder el control del proyecto. Por eso se toma su diseño y se implementa en nuestro servidor Node, que solo necesita TCP.

**Qué aporta OpenSim a cada pendiente**

| Pendiente | Qué hace OpenSim | Qué haremos |
|---|---|---|
| 7 Permisos | Máscaras copiar/modificar/transferir para creador, dueño actual, siguiente dueño y todos; `serverside_object_permissions`; dioses de región | **Hecho en v5.9** (dueño actual y siguiente dueño). Falta «cualquiera»: mover/editar, vender y administradores |
| 8 Inventario | Carpetas por usuario; «tomar» un objeto lo guarda y «soltar» lo coloca | Inventario por usuario en `world.json`; tomar = quitar del mundo conservando permisos; soltar = crearlo de nuevo. **Hecho en v6.0.** Reutiliza el modelo de permisos de v5.9. No cierra por sí solo el hueco de «limpiar permisos» agrupando: eso requiere cuentas y huellas de contenido |
| 10 Scripting | Eventos LSL: `touch_start`, `timer`, `collision_start`, `sensor`, `state_entry`, `on_rez`, `listen`, `at_target`, `moving_start`, `changed` | Reglas en datos (JSON), sin código libre: *evento → acciones*. Eventos: tocar, temporizador, acercarse, estado inicial. Acciones: mover/girar hacia un punto, mostrar/ocultar, cambiar color, decir en el chat, teletransportar. Límites: máximo de reglas por objeto y temporizador mínimo de 1 s. **Hecho en v6.2.** Falta: colisión, escuchar el chat, giro continuo, condiciones y variables |
| 11 Parcelas | `PrimLimitsModule`, `LinksetPrims`, límites por región y por parcela | **Hecho en v6.1**: parcelas rectangulares con dueño, permiso de construir (todos/dueño), máximo de objetos y devolver objetos. Falta venta/alquiler, subdividir y fusionar, y permisos por grupo o lista de acceso |
| 12 Rendimiento | El simulador envía a cada visor solo lo cercano | Enviar al cliente solo los objetos cercanos y el resto simplificado |

**Hallazgos al revisar nuestro código**

1. **Guardado no atómico** → corregido en v5.9.
2. **Deshacer borrado perdía creador y permisos** → corregido en v5.9 (papelera por jugador).
3. **Límites de tamaño incoherentes** → corregido en v6.29: ambos lados usan 0,01–100 (OpenSim usa 0,001–256 en objetos no físicos).
4. **Archivos subidos sin limpieza** → corregido en v6.29: recolector de archivos sin referencias, con 7 días de margen.
5. **Identidad = código del navegador**: sin cuentas no hay administradores reales, ni forma de recuperar objetos, ni permisos fuertes. Es lo que más limita los pendientes 7 y 14. Pendiente: cuentas con contraseña y un rol de administrador del servidor (el equivalente al nivel 200 de OpenSim).
6. **`init` envía todos los objetos de un mundo** a cada jugador que entra: no escala (pendiente 12).
7. **Un solo proceso y un solo archivo JSON**: aceptable ahora; si el mundo crece habría que pasar a una base de datos (OpenSim usa SQLite por defecto).

**Orden propuesto.** 7 (hecho en parte) → 8 inventario (hecho en v6.0) → 11 parcelas (hecho en v6.1) → 10 reglas (hecho en v6.2) → **cuentas** → 12 rendimiento. Después, un **importador `.oar`** en Node (cajas, cilindros, esferas, toros, tubos y anillos con posición, giro, tamaño y color; los linksets pasarían a grupos; esculpidos, mallas y texturas JPEG2000 quedan fuera al principio). Para validarlo hace falta un `.oar` real: se puede generar arrancando OpenSim en tu equipo (necesita .NET 8; en la consola de ejemplo cambia el usuario y la clave `Test / secret` antes de abrirlo a la red).

## Pendiente

Basado en la revisión de Second Life (avatares, construcción, permisos y scripting). Orden recomendado: 1 → 2 → 3 → 4 → 5.

### Edición
1. [x] ~~Ejes de edición con el ratón, deshacer y rehacer, copiar arrastrando y mover en altura~~ (hecho en v5.2)
2. [x] ~~Mover varios objetos a la vez y editar color o material de un grupo completo~~ (hecho en v5.2)

### Avatar
3. [x] ~~Avatar glTF con esqueleto y animaciones (reposo, caminar, saltar), un mismo esqueleto para todos~~ (hecho en v5.3)
4. [x] ~~Accesorios: acoplar grupos a la cabeza o a la mano del avatar~~ (hecho en v5.4)
5. [x] ~~Personalización (altura, complexión, elegir colores)~~ (hecho en v5.5)

### Objetos y permisos
6. [x] ~~Importar modelos glTF y texturas con imágenes propias~~ (hecho en v5.6)
7. [~] **Permisos tipo Second Life:** ~~copiar, modificar y transferir, regalar objetos y devolver objetos como creador del mundo~~ (hecho en v5.9). Falta: permiso de mover/editar para cualquiera, vender, administrador del servidor y cuentas
8. [x] ~~**Inventario personal:** guardar grupos como piezas reutilizables y colocarlos en cualquier mundo~~ (hecho en v6.0). Falta: carpetas, buscar y arrastrar desde el inventario
9. [x] ~~**Grupos anidados** (grupos dentro de grupos; Second Life no lo permite)~~ (hecho en v6.28, probado con el cliente en Chromium sin interfaz y la validación del servidor aislada; sin probar con servidor real). Falta: modelos `.glb` y reglas en niveles profundos
10. [x] ~~**Scripting seguro por reglas** (por ejemplo "al hacer clic, abrir puerta"), definido en datos y no en código libre~~ (hecho en v6.2). Falta: colisión, escuchar el chat, giro continuo, condiciones, variables y elegir la pieza con un clic en el mundo (v6.20 ya tiene un editor por pieza, con selector numerado)

### Mundo
10b. [x] ~~Varios mundos con su propio contenido y ambiente~~ (hecho en v5.8)
11. [x] ~~**Parcelas:** zonas donde se puede o no construir, con límite de objetos por parcela~~ (hecho en v6.1). Falta: vender o alquilar, subdividir/fusionar, listas de acceso y prohibir entrar
12. [~] **Rendimiento:** ~~no dibujar lo lejano~~ (v6.17), ~~enviar solo lo cercano~~ (v6.18), ~~simplificar piezas pequeñas y compartir geometrías, y medir con muchos objetos~~ (v6.30, medido en Chromium sin GPU), ~~fusionar las piezas de objetos lejanos para bajar las llamadas de dibujo~~ (v6.31: −61 % de llamadas en el mundo denso, medido sin GPU). Falta: medir en una GPU real, vigilar la memoria de las mallas fusionadas e instanciar piezas repetidas
13. [x] ~~Social: lista de amigos, teletransporte a lugares guardados, ciclo de día y noche~~ (ya existía en el código; revisado en v6.29). Falta, si se quiere: lugares guardados en el servidor y hora del día compartida
14. [~] Economía, voz y publicar en internet: ~~parte 1, servidor listo para internet (proxy, límites, Docker)~~ (v6.32). Falta: economía y voz

### Catálogo de objetos y plantillas (v6.7–v6.15)
15. [x] **Plantillas con puertas y ventanas que se abran**: ~~3 plantillas con puertas (v6.19)~~, ~~granero, hospital e iglesia con puerta (v6.21)~~. ~~aula, laboratorio, comercio, edificio, gallinero y faro (v6.22)~~. Falta, si se quiere: giro sobre bisagra y escaleras interiores. Antes: hoy son solo decoración. Las reglas de v6.2 (tocar → girar o mover) existen, pero solo funcionan en el objeto de primer nivel y no dentro de grupos, así que una plantilla no puede llevar una puerta con su propia regla. Depende del pendiente «reglas dentro de grupos» del punto 10
16. [x] ~~**Plantillas propias, favoritos y recientes en el servidor**~~ (hecho en v6.27, probado con servidor real y Chromium sin interfaz). Antes: hoy viven en el navegador (`localStorage`) y solo se mueven a mano con Exportar/Importar. Con cuentas (punto 5 de las notas de OpenSim) podrían seguir a la persona a cualquier navegador
17. [x] ~~**Carpetas o categorías propias** para agrupar «Mis plantillas» (hoy solo se pueden renombrar y ordenar con ◂ ▸)~~ (hecho en v6.25, sin probar en navegador)
18. [x] ~~**Más plantillas**: playa, desierto, nieve e interiores (baño, sala, oficina)~~ (hecho en v6.23, sin probar en navegador). Falta, si se quiere: más interiores (comedor, tienda, biblioteca) y versiones con puerta
19. [x] ~~**Controles táctiles más grandes** en los botones pequeños de las plantillas propias (✎, ✕, ◂ ▸) y de las estrellas ☆, que en celular pueden costar de acertar~~ (hecho en v6.24, sin probar en celular real)
20. [x] ~~**Revisar materiales metálicos**: el material `metal` se ve muy oscuro sin un mapa de entorno; en las plantillas nuevas se usó `mate` o `brillo` para evitarlo, pero las de antes (por ejemplo la farola) siguen con `metal`~~ (hecho en v6.24: el metal ahora es 0,55 / 0,4)
21. [x] ~~**Plantillas propias con modelos importados (.glb)**~~ (hecho en v6.26, sin probar en navegador). Los modelos se colocan como objetos sueltos junto al grupo
22. [x] ~~Miniaturas: se generan en cada visita al abrir *Crear* (unos segundos en equipos lentos). Se podrían guardar en caché~~ (hecho en v6.24 para el catálogo)

**Qué se probó y qué no (v6.7–v6.15).** Probado en navegador: la paleta con buscador y filtros, miniaturas, colocar plantillas (incluidas aula, bus, avión, molino, hospital, iglesia, cruce, corral, tractor), guardar/renombrar/ordenar/exportar/importar plantillas propias, favoritos y recientes. Las 66 plantillas y las 29 formas pasan la validación del servidor y se revisaron una a una en una galería de imágenes, aunque algunas salieron recortadas en la imagen. **No se probó** colocar las 95 piezas seguidas en un mismo mundo (el entorno de pruebas renderizaba muy lento), ni el uso en pantallas táctiles, ni con varios jugadores a la vez.
