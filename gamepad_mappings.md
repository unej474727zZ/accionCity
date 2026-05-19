# 🎮 Controles de Mando Actualizados y Paso del Tiempo

Hemos implementado las combinaciones de botones para alternar el mapa y el chat en tiempo real desde el joystick. Además, **restauramos el ciclo de día y noche con sombras dinámicas optimizadas**, y le añadimos un sistema futurista de **reconocimiento de voz** al chat para el mando.

---

## 📋 Distribución Física del Mando (Gamepad Mappings)

| Control Físico (Gamepad) | Acción en Juego | Detalles del Comportamiento |
| :--- | :--- | :--- |
| **Botón B** (Index 1) | **Saltar / Interactuar Vehículo** | Si estás a pie, salta (o entra a un vehículo si estás a rango de 12m). Si estás conduciendo, te bajas del vehículo. |
| **Botón Y** (Index 3) | **Equipar / Cambiar Arma** | Si el arma está guardada (holstered), la hace aparecer. Si ya está afuera, rota (cicla) al siguiente arma. |
| **Cruz Derecha** (D-Pad Right - Index 15) | **Guardar Arma (Holster)** | Si tienes un arma equipada, la guarda/desequipa en la cartuchera de forma instantánea. |
| **Select** (Index 8) | **Visor Nocturno (Night Vision)** | Activa o desactiva el filtro visual nocturno (luz verde/visión nocturna) en toda la pantalla. |
| **Cruz Izquierda** (D-Pad Left - Index 14) | **Láser On/Off** | Enciende o apaga el puntero láser de tu arma para disparar desde la cadera. |
| **Cruz Arriba** (D-Pad Up - Index 12) | **Acercar Cámara (Zoom In)** | Acerca la cámara hacia el personaje. Al pasar de `0.8` metros entra automáticamente en **Modo Primera Persona**. |
| **Cruz Abajo** (D-Pad Down - Index 13) | **Alejar Cámara (Zoom Out)** | Aleja la cámara del personaje en Modo Tercera Persona (hasta un límite de `15.0` metros). |
| **R1 + R2 al mismo tiempo** (Index 5 + 7) | **Mostrar/Quitar Mapa** | Abre el mapa en pantalla completa (y libera el Pointer Lock para poder arrastrarlo). Presionar de nuevo para cerrarlo y volver a apuntar. |
| **L1 + L2 al mismo tiempo** (Index 4 + 6) | **Mostrar/Quitar Chat (Con Voz)** | Abre el chat multijugador y **activa el micrófono**. Habla para dictar tu mensaje. Se enviará automáticamente cuando termines de hablar. |

---

## 🎤 Sistema de Chat por Dictado de Voz (Speech-to-Text)

Para evitar la molestia de tener que usar el teclado físico cuando juegas con joystick, añadimos soporte para la API nativa de reconocimiento de voz del navegador:

1. Al presionar **L1 + L2**, se muestra el contenedor del chat y se inicia la escucha del micrófono (`es-ES`).
2. El campo del chat se ilumina con un **borde rojo brillante** y cambia a `🎤 Escuchando... habla ahora`.
3. Al terminar de hablar (se detecta silencio), la API dispara el evento de finalización, **envía el texto traducido automáticamente al servidor**, cierra la interfaz del chat y reactiva el modo de juego en pantalla completa (Pointer Lock) de forma automática.

---

## 🌅 Ciclo de Día/Noche y Sombras de Alto Rendimiento

Para volver a activar el ciclo día/noche y las sombras sin ralentizar los FPS del juego:

1. **Sombras Dinámicas Enfocadas (Cascaded-style Shadow Camera):**
   * El frustum de renderizado de la cámara de sombras (`DirectionalLight.shadow.camera`) tiene un radio limitado a **35 metros** y está enlazado a la posición del jugador local en la función `animate()`.
   * **¿Por qué no ralentiza el juego?** Al estar limitado a 35 metros, Three.js descarta automáticamente todos los edificios y objetos lejanos al calcular las sombras, reduciendo los draw calls y manteniendo un framerate excelente.
2. **Paso del Tiempo Suave (180 segundos por ciclo):**
   * El sol gira en base al tiempo (`Date.now()`). Al amanecer y atardecer (cuando la altura del sol es menor al 25%), el color del cielo hace una **transición lerp hacia un naranja cálido/atardecer**, para luego irse a un azul medianoche oscuro a la noche.
3. **Apagado Automático Nocturno:**
   * Cuando el sol se oculta bajo la línea del horizonte, **desactivamos `dirLight.castShadow`**. Esto detiene el renderizado de mapas de sombras durante el período nocturno, otorgando un incremento masivo en el rendimiento cuando no se necesitan sombras de sol.
4. **Suelo Receptor (Asphalt Floor):**
   * Cambiamos el material del suelo de `MeshBasicMaterial` a un `MeshLambertMaterial` muy ligero, permitiendo recibir las sombras del personaje, vehículos y proyectiles sin consumir recursos de GPU.
