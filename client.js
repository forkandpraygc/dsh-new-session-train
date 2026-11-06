window.__ModuleLoader__.load({
	id: "@local/dsh-new-session-train",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** Canvas id, so an HMR reload replaces the overlay instead of stacking. */
		const TRAIN_ID = "dsh-new-session-train";

		/** Train tuning; set enabled to false to remove the train without uninstalling. */
		const TRAIN = {
			enabled: true,
			baseSpeed: 46,
			hoverSpeed: 92,
			canvasHeight: 168,
			trackOffset: 7,
			topPadding: 30,
		};

		/** Fallback labels, used only if the CSS-module class token is unavailable. */
		const NEW_SESSION_LABELS = new Set([
			"new session",
			"новая сессия",
			"新建会话",
			"neue sitzung",
			"nouvelle session",
			"nueva sesión",
			"新しいセッション",
			"nova sessão",
		]);

		/**
		 * Find the sidebar "New session" control. The stable marker is the
		 * CSS-module token `newSession`; the hash prefix changes between builds
		 * while the local name stays, so a substring check survives upgrades.
		 * @returns the largest visible matching button, or null.
		 */
		function findNewSessionButton() {
			const candidates = Array.from(document.querySelectorAll("button"));
			const byClass = [];
			const byLabel = [];
			for (const candidate of candidates) {
				const classMatch = Array.from(candidate.classList).some(
					(name) => name.indexOf("newSession") !== -1,
				);
				const label = (candidate.getAttribute("aria-label") || "").trim().toLowerCase();
				const labelMatch = NEW_SESSION_LABELS.has(label);
				if (!classMatch && !labelMatch) continue;
				if (candidate.closest("[inert]") !== null) continue;
				const rect = candidate.getBoundingClientRect();
				if (rect.width < 24 || rect.height < 16) continue;
				const style = getComputedStyle(candidate);
				if (
					style.display === "none" ||
					style.visibility === "hidden" ||
					Number(style.opacity) === 0
				) {
					continue;
				}
				if (classMatch) byClass.push(candidate);
				else byLabel.push(candidate);
			}

			/** Largest visible candidate, so a duplicate in a hidden rail loses. */
			const largest = (list) => {
				let best = null;
				let bestArea = 0;
				for (const candidate of list) {
					const rect = candidate.getBoundingClientRect();
					const area = rect.width * rect.height;
					if (area > bestArea) {
						best = candidate;
						bestArea = area;
					}
				}
				return best;
			};

			// Prefer the sidebar row's stable CSS-module token. The brand button
			// also opens a new session but is much larger, so a pure area sort
			// would put the train around the logo instead of the menu item.
			return largest(byClass) ?? largest(byLabel);
		}

		/**
		 * Resolve a theme custom property to a canvas-usable colour.
		 * @param button - element whose computed style carries the theme.
		 * @param property - custom property name.
		 * @param fallback - colour used when the token is missing or invalid.
		 */
		function colorOf(button, property, fallback) {
			const value = getComputedStyle(button).getPropertyValue(property).trim();
			if (value === "" || value.startsWith("var(")) return fallback;
			if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
				return CSS.supports("color", value) ? value : fallback;
			}
			return value;
		}

		/** Trace a rounded rectangle into the current path. */
		function roundedPath(g, x, y, w, h, radius) {
			const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
			g.beginPath();
			g.moveTo(x + r, y);
			g.arcTo(x + w, y, x + w, y + h, r);
			g.arcTo(x + w, y + h, x, y + h, r);
			g.arcTo(x, y + h, x, y, r);
			g.arcTo(x, y, x + w, y, r);
			g.closePath();
		}

		/**
		 * Sample a rounded-rectangle loop into a polyline with cumulative
		 * distances, so a train can be placed at any distance along it.
		 */
		function buildTrack(x, y, w, h, radius) {
			const points = [];
			const corner = (cx, cy, from, to) => {
				const steps = 7;
				for (let i = 0; i <= steps; i += 1) {
					const angle = from + ((to - from) * i) / steps;
					points.push({
						x: cx + Math.cos(angle) * radius,
						y: cy + Math.sin(angle) * radius,
					});
				}
			};

			points.push({ x: x + radius, y });
			points.push({ x: x + w - radius, y });
			corner(x + w - radius, y + radius, -Math.PI / 2, 0);
			points.push({ x: x + w, y: y + h - radius });
			corner(x + w - radius, y + h - radius, 0, Math.PI / 2);
			points.push({ x: x + radius, y: y + h });
			corner(x + radius, y + h - radius, Math.PI / 2, Math.PI);
			points.push({ x, y: y + radius });
			corner(x + radius, y + radius, Math.PI, Math.PI * 1.5);

			const deduped = [];
			for (const point of points) {
				const last = deduped[deduped.length - 1];
				if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < 0.01) continue;
				deduped.push(point);
			}
			if (deduped.length > 2) {
				const first = deduped[0];
				const last = deduped[deduped.length - 1];
				if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) deduped.pop();
			}

			const cumulative = [0];
			let total = 0;
			for (let i = 0; i < deduped.length; i += 1) {
				const a = deduped[i];
				const b = deduped[(i + 1) % deduped.length];
				total += Math.hypot(b.x - a.x, b.y - a.y);
				cumulative.push(total);
			}

			/** Point and tangent angle at a distance around the loop. */
			const pointAt = (distance) => {
				if (total <= 0) return { x, y, angle: 0 };
				let d = distance % total;
				if (d < 0) d += total;
				let low = 0;
				let high = deduped.length;
				while (low + 1 < high) {
					const mid = (low + high) >> 1;
					if (cumulative[mid] <= d) low = mid;
					else high = mid;
				}
				const a = deduped[low];
				const b = deduped[(low + 1) % deduped.length];
				const span = cumulative[low + 1] - cumulative[low] || 1;
				const mix = (d - cumulative[low]) / span;
				return {
					x: a.x + (b.x - a.x) * mix,
					y: a.y + (b.y - a.y) * mix,
					angle: Math.atan2(b.y - a.y, b.x - a.x),
				};
			};

			return { points: deduped, length: total, pointAt };
		}

		/** Draw the locomotive in local coordinates, facing +x. */
		function drawLocomotive(g, palette) {
			g.fillStyle = "rgba(0,0,0,.14)";
			g.beginPath();
			g.ellipse(-1, 4.6, 10, 1.6, 0, 0, Math.PI * 2);
			g.fill();

			g.fillStyle = palette.accent;
			roundedPath(g, -8.5, -7.5, 7, 8, 2);
			g.fill();
			g.fillStyle = "rgba(0,0,0,.18)";
			roundedPath(g, -8.5, -7.5, 7, 8, 2);
			g.fill();
			g.fillStyle = palette.window;
			roundedPath(g, -7, -6, 3.4, 2.6, 0.8);
			g.fill();

			g.fillStyle = palette.accent;
			roundedPath(g, -6, -3, 14.5, 6, 2.4);
			g.fill();

			g.fillStyle = "#28323f";
			roundedPath(g, 4.2, -7, 2, 4.6, 0.6);
			g.fill();

			g.fillStyle = palette.lamp;
			g.beginPath();
			g.arc(8.6, -0.3, 1.3, 0, Math.PI * 2);
			g.fill();

			g.fillStyle = palette.wheel;
			for (const wheelX of [-4.2, 4.2]) {
				g.beginPath();
				g.arc(wheelX, 3.7, 1.45, 0, Math.PI * 2);
				g.fill();
			}
			g.fillStyle = "rgba(255,255,255,.55)";
			for (const wheelX of [-4.2, 4.2]) {
				g.beginPath();
				g.arc(wheelX, 3.7, 0.55, 0, Math.PI * 2);
				g.fill();
			}
		}

		/** Draw one wagon in local coordinates, facing +x. */
		function drawWagon(g, palette) {
			g.fillStyle = "rgba(0,0,0,.12)";
			g.beginPath();
			g.ellipse(0, 4.2, 7, 1.4, 0, 0, Math.PI * 2);
			g.fill();

			g.fillStyle = palette.wagon;
			roundedPath(g, -5, -3, 10, 6, 1.8);
			g.fill();
			g.fillStyle = "rgba(255,255,255,.28)";
			roundedPath(g, -4.2, -2.2, 8.4, 1.2, 0.6);
			g.fill();

			g.fillStyle = palette.wheel;
			for (const wheelX of [-2.8, 2.8]) {
				g.beginPath();
				g.arc(wheelX, 3.4, 1.25, 0, Math.PI * 2);
				g.fill();
			}
			g.fillStyle = "rgba(255,255,255,.5)";
			for (const wheelX of [-2.8, 2.8]) {
				g.beginPath();
				g.arc(wheelX, 3.4, 0.48, 0, Math.PI * 2);
				g.fill();
			}
		}

		/**
		 * Mount the decorative train that circles the sidebar's New session
		 * button on a small canvas overlay. The canvas is fixed above the app,
		 * transparent to pointer events, and removed with the plugin effect.
		 * @returns cleanup for the animation, canvas, and listeners.
		 */
		function mountNewSessionTrain() {
			if (!TRAIN.enabled) return () => {};
			if (typeof document === "undefined" || document.body == null) return () => {};
			if (typeof document.getElementById !== "function") return () => {};
			if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
				return () => {};
			}
			const stale = document.getElementById(TRAIN_ID);
			if (stale !== null) stale.remove();
			// Migration: the train used to live in the control-motion bundle.
			// Remove that overlay if its module has not reloaded yet, so the
			// first install never shows two trains at once.
			const previous = document.getElementById("dsh-control-motion-train");
			if (previous !== null) previous.remove();

			const canvas = document.createElement("canvas");
			canvas.id = TRAIN_ID;
			canvas.setAttribute("aria-hidden", "true");
			Object.assign(canvas.style, {
				position: "fixed",
				left: "0",
				top: "0",
				width: "100%",
				height: `${TRAIN.canvasHeight}px`,
				pointerEvents: "none",
				zIndex: "60",
				opacity: "0",
				transition: "opacity 220ms ease",
			});
			if (typeof canvas.getContext !== "function") return () => {};
			const g = canvas.getContext("2d");
			if (g === null) return () => {};

			document.body.appendChild(canvas);

			const reduced =
				typeof window.matchMedia === "function"
					? window.matchMedia("(prefers-reduced-motion: reduce)")
					: { matches: false };
			const puffs = [];
			let dpr = 1;
			let cssWidth = 0;
			let originY = -1;
			let button = null;
			let lastLookup = 0;
			let progress = 0.02;
			let speed = TRAIN.baseSpeed;
			let lastTime = 0;
			let puffTimer = 0;
			let palette = null;
			let darkTheme = null;
			let frame = 0;

			const resize = () => {
				dpr = Math.min(window.devicePixelRatio || 1, 2);
				cssWidth = Math.max(1, window.innerWidth);
				canvas.width = Math.round(cssWidth * dpr);
				canvas.height = Math.round(TRAIN.canvasHeight * dpr);
				g.setTransform(dpr, 0, 0, dpr, 0, 0);
			};

			const refreshPalette = (force) => {
				if (button === null) return;
				const dark =
					document.documentElement.hasAttribute("data-ds-dark-theme") ||
					document.body.hasAttribute("data-ds-dark-theme") ||
					(typeof window.matchMedia === "function" &&
						window.matchMedia("(prefers-color-scheme: dark)").matches);
				if (!force && dark === darkTheme && palette !== null) return;
				darkTheme = dark;
				palette = {
					accent: colorOf(button, "--dsw-alias-state-business-primary", dark ? "#7aa2ff" : "#3b6ef5"),
					wagon: dark ? "#ffc266" : "#e89a2b",
					track: dark ? "rgba(226,232,240,.16)" : "rgba(15,23,42,.14)",
					sleeper: dark ? "rgba(226,232,240,.24)" : "rgba(15,23,42,.20)",
					wheel: dark ? "#cbd5e1" : "#1f2937",
					window: dark ? "#e0f2fe" : "#dbeafe",
					smoke: dark ? "rgba(226,232,240,.35)" : "rgba(71,85,105,.28)",
					lamp: "#ffd166",
				};
			};

			const drawTrack = (track) => {
				g.lineWidth = 1.1;
				g.strokeStyle = palette.sleeper;
				for (let distance = 0; distance < track.length; distance += 10) {
					const point = track.pointAt(distance);
					const normal = point.angle + Math.PI / 2;
					const nx = Math.cos(normal) * 2.2;
					const ny = Math.sin(normal) * 2.2;
					g.beginPath();
					g.moveTo(point.x - nx, point.y - ny);
					g.lineTo(point.x + nx, point.y + ny);
					g.stroke();
				}

				g.lineWidth = 1.1;
				g.strokeStyle = palette.track;
				g.beginPath();
				g.moveTo(track.points[0].x, track.points[0].y);
				for (let i = 1; i < track.points.length; i += 1) {
					g.lineTo(track.points[i].x, track.points[i].y);
				}
				g.closePath();
				g.stroke();
			};

			const draw = (time) => {
				frame = window.requestAnimationFrame(draw);
				const dt = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000);
				lastTime = time;

				if (button !== null && !button.isConnected) {
					button = null;
					palette = null;
				}
				if (button === null && time - lastLookup > 300) {
					lastLookup = time;
					button = findNewSessionButton();
					if (button !== null) refreshPalette(true);
				}
				if (button === null) {
					canvas.style.opacity = "0";
					g.clearRect(0, 0, cssWidth, TRAIN.canvasHeight);
					return;
				}

				refreshPalette(false);
				if (palette === null) return;
				const rect = button.getBoundingClientRect();
				if (
					rect.width < 24 ||
					rect.height < 16 ||
					rect.right <= 2 ||
					rect.left >= window.innerWidth - 2 ||
					rect.bottom < 0 ||
					rect.top > window.innerHeight
				) {
					canvas.style.opacity = "0";
					g.clearRect(0, 0, cssWidth, TRAIN.canvasHeight);
					return;
				}

				let top = rect.top - TRAIN.topPadding;
				top = Math.max(0, Math.min(window.innerHeight - TRAIN.canvasHeight, top));
				if (Math.abs(top - originY) > 0.5) {
					originY = top;
					canvas.style.transform = `translateY(${top}px)`;
				}

				g.clearRect(0, 0, cssWidth, TRAIN.canvasHeight);
				canvas.style.opacity = "1";

				const offset = TRAIN.trackOffset;
				let tx = rect.left - offset;
				let ty = rect.top - originY - offset;
				let tw = rect.width + offset * 2;
				let th = rect.height + offset * 2;
				const margin = 5;
				if (tx < margin) {
					tw -= margin - tx;
					tx = margin;
				}
				if (ty < margin) {
					th -= margin - ty;
					ty = margin;
				}
				if (tx + tw > cssWidth - margin) tw = cssWidth - margin - tx;
				if (ty + th > TRAIN.canvasHeight - margin) th = TRAIN.canvasHeight - margin - ty;
				if (tw < 24 || th < 20) {
					canvas.style.opacity = "0";
					return;
				}

				const track = buildTrack(tx, ty, tw, th, Math.min(th / 2, 14));
				if (track.length <= 0) return;

				drawTrack(track);

				const scale = Math.max(0.72, Math.min(1, rect.width / 190));
				const gap = 13 * scale;
				const targetSpeed = reduced.matches
					? 0
					: button.matches(":hover")
						? TRAIN.hoverSpeed
						: TRAIN.baseSpeed;
				if (reduced.matches) {
					speed = 0;
				} else {
					speed += (targetSpeed - speed) * Math.min(1, dt * 3);
					progress = (progress + (speed * dt) / track.length) % 1;
				}

				if (!reduced.matches && speed > 6) {
					puffTimer -= dt;
					if (puffTimer <= 0) {
						const head = track.pointAt(progress * track.length);
						const localX = 4.5 * scale;
						const localY = -8 * scale;
						const cos = Math.cos(head.angle);
						const sin = Math.sin(head.angle);
						puffs.push({
							x: head.x + localX * cos - localY * sin,
							y: head.y + localX * sin + localY * cos,
							vx: (Math.random() - 0.5) * 4,
							vy: -7 - Math.random() * 5,
							life: 0,
							max: 0.8 + Math.random() * 0.5,
							r: 1.1 + Math.random() * 1.5,
						});
						if (puffs.length > 28) puffs.shift();
						puffTimer = 0.15 + Math.random() * 0.08;
					}
				}

				for (let i = puffs.length - 1; i >= 0; i -= 1) {
					const puff = puffs[i];
					puff.life += dt;
					if (puff.life >= puff.max) {
						puffs.splice(i, 1);
						continue;
					}
					puff.x += puff.vx * dt;
					puff.y += puff.vy * dt;
					puff.vy -= 1.5 * dt;
				}

				g.fillStyle = palette.smoke;
				for (const puff of puffs) {
					g.globalAlpha = (1 - puff.life / puff.max) * 0.55;
					g.beginPath();
					g.arc(puff.x, puff.y, puff.r * (1 + puff.life * 1.6), 0, Math.PI * 2);
					g.fill();
				}
				g.globalAlpha = 1;

				const base = progress * track.length;
				for (let index = 2; index >= 0; index -= 1) {
					const point = track.pointAt(base - index * gap);
					g.save();
					g.translate(point.x, point.y);
					g.rotate(point.angle);
					g.scale(scale, scale);
					if (index === 0) drawLocomotive(g, palette);
					else drawWagon(g, palette);
					g.restore();
				}
			};

			const onResize = () => resize();
			window.addEventListener("resize", onResize);

			const themeObserver = new MutationObserver(() => {
				palette = null;
			});
			const observed = [document.documentElement, document.body];
			for (const target of observed) {
				if (target === null || target === undefined) continue;
				themeObserver.observe(target, {
					attributes: true,
					attributeFilter: ["class", "style", "data-ds-dark-theme", "data-ds-theme-source"],
				});
			}

			const onMotionPreference = () => {
				lastTime = 0;
			};
			if (typeof reduced.addEventListener === "function") {
				reduced.addEventListener("change", onMotionPreference);
			}

			resize();
			button = findNewSessionButton();
			if (button !== null) refreshPalette(true);
			frame = window.requestAnimationFrame(draw);

			return () => {
				window.cancelAnimationFrame(frame);
				window.removeEventListener("resize", onResize);
				themeObserver.disconnect();
				if (typeof reduced.removeEventListener === "function") {
					reduced.removeEventListener("change", onMotionPreference);
				}
				puffs.length = 0;
				canvas.remove();
			};
		}

		/**
		 * Mount the decorative train around the sidebar's New session button.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => {
				try {
					return mountNewSessionTrain();
				} catch (error) {
					console.warn("new-session-train: train disabled", error);
					return () => {};
				}
			}, "new-session-train: animated train");
		}

		exports.apply = apply;
		exports.TRAIN = TRAIN;
		exports.TRAIN_ID = TRAIN_ID;
		return module.exports;
	},
});
