Aquí tienes un documento base pensado como un **Game Design Document (GDD)**. Está enfocado en construir una Mini App para MiniPay que sea rápida, competitiva y con potencial de monetización.

# HexArena

## Game Design Document (Versión 1.0)

## Resumen

HexArena es un juego de estrategia inspirado en Othello, diseñado específicamente para dispositivos móviles y distribuido como una Mini App de MiniPay.

El objetivo es ofrecer partidas rápidas, altamente estratégicas y completamente basadas en habilidad, integrando una economía con micropagos, rankings y torneos.

No pretende ser una copia de Othello, sino una evolución moderna construida sobre un tablero hexagonal.

---

# Objetivos

* Partidas entre 2 y 4 minutos.
* Reglas fáciles de aprender.
* Gran profundidad estratégica.
* Sin elementos aleatorios durante la partida.
* Backend sencillo de validar.
* Ideal para torneos.
* Compatible con pequeñas apuestas.
* Excelente experiencia móvil.

---

# Público objetivo

* Usuarios de MiniPay.
* Jugadores casuales.
* Personas interesadas en juegos de estrategia.
* Usuarios acostumbrados a juegos competitivos rápidos.
* Comunidad Web3.

---

# Filosofía del juego

Cada partida debe sentirse como una batalla mental.

La victoria dependerá exclusivamente de las decisiones del jugador.

No existirán cartas, dados ni eventos aleatorios.

Cada movimiento deberá tener consecuencias.

---

# Tablero

Se propone utilizar un tablero hexagonal.

Ventajas:

* Más moderno.
* Mejor sensación visual.
* Todas las direcciones tienen el mismo valor.
* Permite diferenciar el juego del Othello clásico.

Tamaño sugerido:

* Radio 4 (61 casillas)
* o Radio 5 (91 casillas)

La versión inicial debería utilizar 61 casillas para mantener partidas rápidas.

---

# Mecánica principal

Cada jugador posee un color.

Los jugadores se alternan realizando movimientos.

Una ficha solamente puede colocarse si captura al menos una ficha enemiga.

Una captura ocurre cuando una línea continua de fichas enemigas queda encerrada entre dos fichas propias siguiendo cualquiera de las seis direcciones del tablero.

Todas las fichas encerradas cambian inmediatamente de color.

La partida termina cuando:

* no quedan movimientos posibles para ambos jugadores;
* el tablero está lleno.

Gana quien controle más casillas.

---

# Diferencias respecto a Othello

No pretende replicar exactamente el juego clásico.

Las diferencias incluyen:

* tablero hexagonal;
* seis direcciones de captura;
* nueva apertura;
* nueva estrategia;
* nuevas zonas importantes.

Esto crea un juego original manteniendo la esencia de "rodear para conquistar".

---

# Sistema de tiempo

Modo Blitz

Cada jugador dispone de:

* 90 segundos totales

o

* 120 segundos totales

Cada movimiento descuenta tiempo.

Cuando un jugador agota su reloj, pierde automáticamente.

Esto mantiene partidas muy dinámicas.

---

# Matchmaking

Existen tres modos.

## Casual

Sin costo.

Sin afectar ranking.

Ideal para aprender.

---

## Competitivo

Afecta el ranking Elo.

No requiere apuestas.

---

## Arena

Cada jugador deposita una pequeña cantidad.

Ejemplos:

0.10 USD

0.25 USD

0.50 USD

1 USD

El ganador recibe el premio menos la comisión de la plataforma.

---

# Ranking

Sistema Elo clásico.

Categorías:

Bronce

Plata

Oro

Platino

Diamante

Maestro

Gran Maestro

El ranking se reinicia parcialmente cada temporada.

---

# Temporadas

Duración:

30 días.

Cada temporada incluye:

* nuevo leaderboard;
* recompensas;
* logros exclusivos;
* skins exclusivas.

---

# Torneos

Torneos diarios.

Ejemplo:

Entrada:

0.50 USD

64 jugadores

Eliminación directa.

Premios para:

* Campeón
* Finalista
* Tercer lugar

También pueden existir torneos gratuitos patrocinados.

---

# Misiones

Ejemplos:

Ganar 3 partidas.

Capturar 50 fichas.

Jugar durante 5 días consecutivos.

Invitar un amigo.

Completar una temporada.

Las misiones entregan monedas cosméticas o entradas gratuitas.

---

# Personalización

Sin afectar la jugabilidad.

Ejemplos:

Tableros.

Temas.

Animaciones.

Efectos de captura.

Avatares.

Marcos.

Emojis.

Celebraciones.

---

# Economía

Ingresos provenientes de:

* comisión por partidas Arena;
* venta de skins;
* pase de temporada;
* entradas a torneos premium;
* cosméticos exclusivos.

Nunca se venderá poder.

Todo el contenido será puramente visual.

---

# Backend

El servidor controla completamente:

* estado del tablero;
* validación de movimientos;
* tiempo restante;
* ganador;
* desconexiones;
* ranking;
* historial.

El cliente únicamente representa la información.

Esto reduce significativamente las posibilidades de hacer trampa.

---

# Prevención de fraude

Todas las jugadas son verificadas por el servidor.

Cada partida queda almacenada.

Puede reproducirse movimiento por movimiento.

Si un jugador abandona:

* pierde automáticamente después de un tiempo configurable.

---

# Estadísticas

Cada jugador tendrá:

Victorias.

Derrotas.

Porcentaje de victorias.

Racha actual.

Racha máxima.

Tiempo promedio por movimiento.

Tiempo promedio por partida.

Capturas promedio.

Ranking histórico.

---

# Historial

Cada partida podrá reproducirse.

El usuario podrá:

* revisar jugadas;
* compartir partidas;
* analizar errores.

---

# Logros

Ejemplos:

Primera victoria.

100 victorias.

1000 capturas.

Diez victorias consecutivas.

Campeón semanal.

Campeón mensual.

---

# Futuras expansiones

Una vez por partida, cada jugador podría disponer de una habilidad especial elegida antes del inicio.

Ejemplos:

## Escudo

Protege una ficha durante un turno.

---

## Radar

Resalta todas las jugadas legales del siguiente turno.

---

## Conversión

Permite convertir una ficha aislada sin necesidad de encerrarla.

Uso limitado a una vez por partida.

---

## Bloqueo

Convierte una casilla vacía en inaccesible durante dos turnos.

---

Estas habilidades deberían introducirse únicamente después de consolidar la versión clásica, para no afectar el equilibrio inicial.

---

# Diseño visual

Estilo futurista.

Inspiración:

* neón;
* ciencia ficción;
* hologramas;
* interfaz minimalista.

Las animaciones deben ser fluidas y rápidas.

Una captura nunca debería durar más de medio segundo.

---

# Sonido

Efectos discretos.

Cada captura produce una pequeña animación sonora.

La música debe ser ambiental para favorecer la concentración.

---

# Objetivo del proyecto

Crear un juego competitivo de estrategia diseñado para convertirse en una de las Mini Apps más utilizadas de MiniPay, combinando partidas cortas, una economía basada en micropagos y una experiencia que premie exclusivamente la habilidad del jugador.

Creo que este documento es una excelente base para una **versión 1.0**. Como siguiente paso, desarrollaría un **GDD completo (30–50 páginas)** con diagramas del tablero hexagonal, reglas matemáticamente definidas, flujo de pantallas (UX), arquitectura cliente-servidor, modelo de datos, protocolo de comunicación en tiempo real y un análisis de balance para garantizar que el juego sea competitivo desde el primer lanzamiento.
