import { o as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as Play, c as Copy, i as Shield, n as Volume2, o as Pause, s as Link2, t as VolumeX } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-DfFNg3q9.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FAST_POLL_MS = 400;
var IDLE_POLL_MS = 2e3;
var PING_INTERVAL_MS = 2e3;
var STALL_MS = 1e4;
var MAX_RECOVERY_ATTEMPTS = 3;
var SIGNAL_RETRY_DELAYS_MS = [250, 750];
function defaultIceServers() {
	return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
}
var P2PRoom = class {
	opts;
	peers = /* @__PURE__ */ new Map();
	/** Per-remote-peer signal delivery chains (order-preserving). */
	signalQueues = /* @__PURE__ */ new Map();
	cursor = 0;
	pollTimer = null;
	pingTimer = null;
	closed = false;
	everPolled = false;
	lastPeersFingerprint = "";
	constructor(opts) {
		this.opts = opts;
	}
	/**
	* The first poll IS the join: it registers this peer and returns the
	* roster. A failed first poll (cold DB, offline tab) must not strand the
	* room: the loop and timers start regardless and the next poll retries.
	*/
	async join() {
		try {
			await this.pollOnce();
		} catch {}
		if (this.closed) return;
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
		this.pingTimer = setInterval(() => {
			this.pingAll();
			this.watchdog();
		}, PING_INTERVAL_MS);
	}
	close() {
		this.closed = true;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		if (this.pingTimer) clearInterval(this.pingTimer);
		for (const slot of this.peers.values()) slot.pc.close();
		this.peers.clear();
		fetch("/api/rtc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				op: "leave",
				room: this.opts.room,
				peer: this.opts.selfId
			}),
			keepalive: true
		}).catch(() => {});
	}
	/** Send on the unreliable game-state channel (drops stale packets). */
	broadcast(data) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		for (const slot of this.peers.values()) if (slot.state?.readyState === "open") slot.state.send(wire);
	}
	/** Send reliably (ordered) to one peer, or to all when peerId is omitted. */
	send(data, peerId) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()];
		for (const slot of targets) if (slot?.reliable?.readyState === "open") slot.reliable.send(wire);
	}
	peerList() {
		return [...this.peers.values()].map((s) => ({ ...s.info }));
	}
	schedulePoll(delay) {
		if (this.closed) return;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = setTimeout(() => void this.poll(), delay);
	}
	anyPairConnecting() {
		for (const s of this.peers.values()) {
			if (s.terminal) continue;
			if (s.info.connectionState !== "connected") return true;
		}
		return false;
	}
	async pollOnce() {
		const params = new URLSearchParams({
			room: this.opts.room,
			peer: this.opts.selfId,
			name: this.opts.name ?? "",
			since: String(this.cursor)
		});
		const res = await fetch(`/api/rtc?${params}`);
		if (this.closed) return;
		if (!res.ok) throw new Error(`signaling poll failed: ${res.status}`);
		const body = await res.json();
		if (this.closed) return;
		if (!this.everPolled) {
			this.everPolled = true;
			this.opts.onConnected?.();
		}
		this.reconcileRoster(body.peers);
		const roster = new Set(body.peers.map((p) => p.id));
		for (const sig of body.signals) {
			this.cursor = Math.max(this.cursor, sig.id);
			await this.onSignal(sig.from, sig.kind, sig.payload, roster);
			if (this.closed) return;
		}
	}
	async poll() {
		if (this.closed) return;
		try {
			await this.pollOnce();
		} catch {}
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
	}
	reconcileRoster(peers) {
		const alive = new Set(peers.map((p) => p.id));
		for (const p of peers) {
			if (p.id === this.opts.selfId) continue;
			const existing = this.peers.get(p.id);
			if (existing) existing.info.name = p.name;
			else this.connectTo(p.id, p.name, this.opts.selfId > p.id);
		}
		for (const [id, slot] of this.peers) if (!alive.has(id)) {
			slot.pc.close();
			this.peers.delete(id);
		}
		this.emitPeers();
	}
	connectTo(peerId, name, initiator) {
		if (this.closed) return null;
		const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? defaultIceServers() });
		const slot = {
			pc,
			makingOffer: false,
			ignoreOffer: false,
			pendingCandidates: [],
			lastProgressAt: Date.now(),
			recoveryAttempts: 0,
			info: {
				id: peerId,
				name,
				connectionState: pc.connectionState,
				candidateType: null,
				rttMs: null
			}
		};
		this.peers.set(peerId, slot);
		pc.onicecandidate = (e) => {
			if (e.candidate) this.sendSignal(peerId, "ice", e.candidate.toJSON());
		};
		pc.onconnectionstatechange = () => {
			slot.info.connectionState = pc.connectionState;
			if (pc.connectionState === "connecting" || pc.connectionState === "connected") slot.lastProgressAt = Date.now();
			if (pc.connectionState === "connected") {
				slot.recoveryAttempts = 0;
				slot.terminal = false;
				this.readCandidateType(slot);
			}
			this.emitPeers();
			if (pc.connectionState === "failed") pc.restartIce();
			if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.schedulePoll(FAST_POLL_MS);
		};
		pc.onnegotiationneeded = async () => {
			try {
				slot.makingOffer = true;
				await pc.setLocalDescription();
				await this.sendSignal(peerId, "offer", pc.localDescription.toJSON());
			} catch {} finally {
				slot.makingOffer = false;
			}
		};
		pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);
		if (initiator) {
			this.attachChannel(slot, pc.createDataChannel("state", {
				ordered: false,
				maxRetransmits: 0
			}));
			this.attachChannel(slot, pc.createDataChannel("reliable", { ordered: true }));
		}
		return slot;
	}
	attachChannel(slot, channel) {
		if (channel.label === "state") slot.state = channel;
		else slot.reliable = channel;
		channel.onopen = () => {
			slot.lastProgressAt = Date.now();
		};
		channel.onmessage = (e) => {
			let msg;
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg.t === "ping") {
				if (slot.state?.readyState === "open") slot.state.send(JSON.stringify({ t: "pong" }));
			} else if (msg.t === "pong") {
				if (slot.pingSentAt) {
					slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
					slot.pingSentAt = void 0;
					this.emitPeers();
				}
			} else this.opts.onMessage?.(slot.info.id, msg.d, channel.label === "state" ? "state" : "reliable");
		};
	}
	/** Apply buffered ICE candidates once a remote description is in place. */
	async flushPendingCandidates(slot) {
		while (slot.pendingCandidates.length > 0) {
			const candidate = slot.pendingCandidates.shift();
			try {
				await slot.pc.addIceCandidate(candidate);
			} catch (err) {
				if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
			}
			if (this.closed) return;
		}
	}
	async onSignal(from, kind, payload, roster) {
		if (this.closed) return;
		let slot = this.peers.get(from);
		if (!slot) {
			if (!roster.has(from)) return;
			const created = this.connectTo(from, "", false);
			if (!created) return;
			slot = created;
		}
		const polite = this.opts.selfId < from;
		try {
			if (kind === "offer" || kind === "answer") {
				const description = payload;
				const collision = kind === "offer" && (slot.makingOffer || slot.pc.signalingState !== "stable");
				slot.ignoreOffer = !polite && collision;
				if (slot.ignoreOffer) return;
				try {
					await slot.pc.setRemoteDescription(description);
				} catch (err) {
					if (kind !== "offer" || slot.recreatedForOffer) throw err;
					const attempts = slot.recoveryAttempts;
					const name = slot.info.name;
					slot.pc.close();
					this.peers.delete(from);
					const fresh = this.connectTo(from, name, false);
					if (!fresh) return;
					fresh.recoveryAttempts = attempts;
					fresh.recreatedForOffer = true;
					slot = fresh;
					await slot.pc.setRemoteDescription(description);
				}
				if (this.closed) return;
				await this.flushPendingCandidates(slot);
				if (this.closed) return;
				if (kind === "offer") {
					await slot.pc.setLocalDescription();
					if (this.closed) return;
					await this.sendSignal(from, "answer", slot.pc.localDescription.toJSON());
				}
			} else if (kind === "ice") {
				const candidate = payload;
				if (!slot.pc.remoteDescription) {
					slot.pendingCandidates.push(candidate);
					return;
				}
				try {
					await slot.pc.addIceCandidate(candidate);
				} catch (err) {
					if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
				}
			}
		} catch {}
	}
	/**
	* Signals are serialized per remote peer (a candidate must never overtake
	* its SDP into the DB) and retried on failure with short backoff.
	*/
	sendSignal(to, kind, payload) {
		const next = (this.signalQueues.get(to) ?? Promise.resolve()).then(() => this.postSignal(to, kind, payload));
		this.signalQueues.set(to, next.catch(() => {}));
		return next;
	}
	async postSignal(to, kind, payload) {
		for (let attempt = 0;; attempt++) {
			if (this.closed) return;
			try {
				const res = await fetch("/api/rtc", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						op: "signal",
						room: this.opts.room,
						from: this.opts.selfId,
						to,
						kind,
						payload
					})
				});
				if (res.ok) return;
				throw new Error(`signal POST failed: ${res.status}`);
			} catch (err) {
				if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
					console.warn(`[p2p] signal ${kind} to ${to} failed after retries`, err);
					return;
				}
				await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
			}
		}
	}
	pingAll() {
		const wire = JSON.stringify({ t: "ping" });
		for (const slot of this.peers.values()) {
			if (slot.state?.readyState !== "open") continue;
			const stale = slot.pingSentAt !== void 0 && performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
			if (slot.pingSentAt === void 0 || stale) {
				slot.pingSentAt = performance.now();
				slot.state.send(wire);
			}
		}
	}
	/**
	* Stuck-pair recovery, piggybacked on the ping interval. A pair that has
	* made no progress for STALL_MS gets rebuilt by the dialer with a FRESH
	* RTCPeerConnection (new DTLS identity — fixes the suspend/resume
	* fingerprint wedge). After MAX_RECOVERY_ATTEMPTS the pair is terminal:
	* visible to the app as its last connectionState, ignored by fast-poll.
	*/
	watchdog() {
		if (this.closed) return;
		const now = Date.now();
		for (const [peerId, slot] of this.peers) {
			const live = slot.pc.connectionState;
			if (live !== slot.info.connectionState) {
				slot.info.connectionState = live;
				if (live === "connecting" || live === "connected") slot.lastProgressAt = now;
				this.emitPeers();
			}
			if (slot.terminal || live === "connected") continue;
			if (now - slot.lastProgressAt <= STALL_MS) continue;
			if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
				slot.terminal = true;
				this.emitPeers();
				continue;
			}
			slot.recoveryAttempts += 1;
			slot.lastProgressAt = now;
			if (this.opts.selfId > peerId) {
				const { name } = slot.info;
				const attempts = slot.recoveryAttempts;
				slot.pc.close();
				this.peers.delete(peerId);
				const fresh = this.connectTo(peerId, name, true);
				if (fresh) fresh.recoveryAttempts = attempts;
				this.schedulePoll(FAST_POLL_MS);
			}
		}
	}
	async readCandidateType(slot) {
		try {
			const stats = await slot.pc.getStats();
			let selected;
			stats.forEach((s) => {
				if (s.type === "candidate-pair" && s.nominated) selected = s;
			});
			const localId = selected?.localCandidateId;
			if (localId) {
				const local = stats.get(localId);
				slot.info.candidateType = local?.candidateType ?? null;
				this.emitPeers();
			}
		} catch {}
	}
	emitPeers() {
		const list = this.peerList();
		const fingerprint = JSON.stringify(list.map((p) => [
			p.id,
			p.name,
			p.connectionState,
			p.candidateType,
			p.rttMs
		]));
		if (fingerprint === this.lastPeersFingerprint) return;
		this.lastPeersFingerprint = fingerprint;
		this.opts.onPeersChanged?.(list);
	}
};
/**
* React binding for P2PRoom. Identity and room id are captured once on mount
* (useState initializers) so re-renders never tear down the mesh.
*/
function defaultRoom() {
	if (typeof window === "undefined") return "room-ssr";
	return `room-${window.location.hostname.split(".")[0]}`.slice(0, 64);
}
function useP2PRoom(options = {}) {
	const [selfId] = (0, import_react.useState)(() => `p-${Math.random().toString(36).slice(2, 10)}`);
	const [room] = (0, import_react.useState)(() => options.room ?? defaultRoom());
	const [name] = (0, import_react.useState)(() => options.name ?? selfId);
	const [peers, setPeers] = (0, import_react.useState)([]);
	const [joined, setJoined] = (0, import_react.useState)(false);
	const roomRef = (0, import_react.useRef)(null);
	const listeners = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	(0, import_react.useEffect)(() => {
		const p2p = new P2PRoom({
			room,
			selfId,
			name,
			onPeersChanged: setPeers,
			onMessage: (from, data, channel) => {
				for (const fn of listeners.current) fn(from, data, channel);
			},
			onConnected: () => setJoined(true)
		});
		roomRef.current = p2p;
		p2p.join();
		return () => {
			roomRef.current = null;
			p2p.close();
		};
	}, [
		room,
		selfId,
		name
	]);
	return {
		selfId,
		room,
		peers,
		joined,
		broadcast: (0, import_react.useCallback)((data) => roomRef.current?.broadcast(data), []),
		send: (0, import_react.useCallback)((data, peerId) => roomRef.current?.send(data, peerId), []),
		onMessage: (0, import_react.useCallback)((fn) => {
			listeners.current.add(fn);
			return () => {
				listeners.current.delete(fn);
			};
		}, [])
	};
}
var OL = [
	{
		d: .75,
		l: -8
	},
	{
		d: .75,
		l: -4
	},
	{
		d: .75,
		l: 0
	},
	{
		d: .75,
		l: 4
	},
	{
		d: .75,
		l: 8
	}
];
function line(skill) {
	return [...skill, ...OL];
}
var IFORM = line([
	{
		d: 5,
		l: 0
	},
	{
		d: 11,
		l: .2
	},
	{
		d: .7,
		l: -23
	},
	{
		d: .7,
		l: 23
	},
	{
		d: 8,
		l: .2
	},
	{
		d: .7,
		l: 11.5
	}
]);
var GUN = line([
	{
		d: 6.2,
		l: 0
	},
	{
		d: 6.3,
		l: -3.6
	},
	{
		d: .7,
		l: -23
	},
	{
		d: .7,
		l: 22
	},
	{
		d: .7,
		l: -13
	},
	{
		d: .7,
		l: 12
	}
]);
var TRIPS = line([
	{
		d: 6.2,
		l: -1.2
	},
	{
		d: 6.2,
		l: -5.5
	},
	{
		d: .7,
		l: -22
	},
	{
		d: .7,
		l: 22
	},
	{
		d: .7,
		l: 15
	},
	{
		d: .7,
		l: 9
	}
]);
var EMPTY = line([
	{
		d: 6,
		l: 0
	},
	{
		d: .7,
		l: 12
	},
	{
		d: .7,
		l: -24
	},
	{
		d: .7,
		l: 23
	},
	{
		d: .7,
		l: -13
	},
	{
		d: .7,
		l: -6
	}
]);
var GOAL = line([
	{
		d: 4.2,
		l: 0
	},
	{
		d: 7.4,
		l: 0
	},
	{
		d: .7,
		l: -8
	},
	{
		d: .7,
		l: 8
	},
	{
		d: 5.6,
		l: .4
	},
	{
		d: .7,
		l: 5.2
	}
]);
var block = (extra = []) => {
	const jobs = Array(11).fill("route");
	for (const i of [
		6,
		7,
		8,
		9,
		10,
		...extra
	]) jobs[i] = "block";
	return jobs;
};
function routes(partial, jobs) {
	return Array.from({ length: 11 }, (_, i) => {
		if (partial[i]) return partial[i];
		if (jobs[i] === "block") return [{
			f: 3.4,
			l: (i - 8) * .15
		}];
		return [];
	});
}
function play(id, name, formation, align, group, blurb, hot, partial, extra = {}, blockers = []) {
	const jobs = block(group === "run" ? [
		2,
		3,
		5,
		...blockers
	] : blockers);
	return {
		id,
		name,
		formation,
		group,
		blurb,
		hot,
		handoffAt: group === "run" ? .32 : 99,
		throwAt: group === "pass" ? 1.7 : 99,
		jobs,
		routes: routes(partial, jobs),
		align,
		...extra
	};
}
var OFFENSE = [
	play("zone", "Inside Zone", "I-Form", IFORM, "run", "Downhill between the tackles. Cut off your blocks.", [1], {
		1: [
			{
				f: 3,
				l: 1.4
			},
			{
				f: 9,
				l: 2.4
			},
			{
				f: 18,
				l: 1.2
			},
			{
				f: 30,
				l: 0
			}
		],
		4: [{
			f: 4,
			l: 1.6
		}, {
			f: 9,
			l: 2
		}],
		0: [{
			f: 1,
			l: -1.5
		}]
	}),
	play("power", "Power", "I-Form", IFORM, "run", "Fullback kicks the end. Backside gap.", [1], {
		1: [
			{
				f: 2,
				l: -1.2
			},
			{
				f: 7,
				l: -3.2
			},
			{
				f: 16,
				l: -2
			},
			{
				f: 28,
				l: -1
			}
		],
		4: [{
			f: 3,
			l: 6
		}, {
			f: 6,
			l: 8
		}],
		0: [{
			f: 1,
			l: 1
		}],
		9: [{
			f: 2,
			l: -5
		}, {
			f: 6,
			l: -4
		}]
	}),
	play("toss", "Toss Sweep", "I-Form", IFORM, "run", "Get the ball outside before the force player arrives.", [1], {
		1: [
			{
				f: .2,
				l: 8
			},
			{
				f: 4,
				l: 16
			},
			{
				f: 14,
				l: 18
			},
			{
				f: 28,
				l: 14
			}
		],
		4: [{
			f: 2,
			l: 8
		}, {
			f: 6,
			l: 14
		}],
		5: [{
			f: 3,
			l: 6
		}, {
			f: 8,
			l: 10
		}],
		0: [{
			f: .4,
			l: 2
		}]
	}, { handoffAt: .22 }),
	play("punch", "Goal Punch", "Goal line", GOAL, "run", "Hats on hats. Lower your shoulder.", [1], {
		1: [
			{
				f: 2,
				l: .3
			},
			{
				f: 6,
				l: .6
			},
			{
				f: 12,
				l: 0
			}
		],
		4: [{
			f: 3,
			l: .4
		}, {
			f: 6,
			l: 0
		}],
		0: [{
			f: .6,
			l: -.6
		}]
	}, { handoffAt: .26 }),
	play("draw", "QB Draw", "Shotgun", GUN, "run", "Show pass, then keep it up the middle.", [0], {
		0: [
			{
				f: -.4,
				l: 0
			},
			{
				f: 2,
				l: .4
			},
			{
				f: 10,
				l: 1
			},
			{
				f: 22,
				l: 0
			}
		],
		1: [{
			f: 1,
			l: -6
		}, {
			f: 4,
			l: -8
		}],
		2: [{
			f: 8,
			l: 1
		}],
		3: [{
			f: 8,
			l: -1
		}]
	}, {
		handoffAt: 99,
		throwAt: 99
	}),
	play("slant", "Slant Flat", "Shotgun", GUN, "pass", "Hot slant. If it's covered, dump it to the flat.", [
		2,
		4,
		1,
		5
	], {
		0: [{
			f: -1.4,
			l: .4
		}],
		2: [{
			f: 3,
			l: .4
		}, {
			f: 11,
			l: 7
		}],
		4: [
			{
				f: 1.5,
				l: -1
			},
			{
				f: 4,
				l: -8
			},
			{
				f: 7,
				l: -12
			}
		],
		3: [{
			f: 16,
			l: -1
		}, {
			f: 28,
			l: 0
		}],
		5: [{
			f: 6,
			l: -1
		}, {
			f: 9,
			l: 2
		}],
		1: [
			{
				f: 1,
				l: -2
			},
			{
				f: 4,
				l: -6
			},
			{
				f: 6,
				l: -5
			}
		]
	}, { throwAt: 1.25 }),
	play("mesh", "Mesh", "Trips", TRIPS, "pass", "Two drags cross. Throw the one the linebacker loses.", [
		4,
		5,
		1,
		3
	], {
		0: [{
			f: -1.2,
			l: -.4
		}],
		4: [
			{
				f: 4,
				l: 0
			},
			{
				f: 6,
				l: -16
			},
			{
				f: 8,
				l: -20
			}
		],
		5: [
			{
				f: 4,
				l: 0
			},
			{
				f: 6,
				l: 14
			},
			{
				f: 8,
				l: 18
			}
		],
		2: [{
			f: 12,
			l: 1
		}, {
			f: 9,
			l: 2
		}],
		3: [{
			f: 18,
			l: -1
		}, {
			f: 30,
			l: 0
		}],
		1: [{
			f: 2,
			l: -4
		}, {
			f: 5,
			l: -2
		}]
	}, { throwAt: 1.55 }),
	play("curl", "Curl Flat", "Shotgun", GUN, "pass", "Outside curls. Rhythm throw as they sit.", [
		2,
		3,
		4,
		5
	], {
		0: [{
			f: -1.6,
			l: 0
		}],
		2: [{
			f: 10,
			l: .4
		}, {
			f: 8,
			l: -.6
		}],
		3: [{
			f: 11,
			l: -.3
		}, {
			f: 8.5,
			l: .8
		}],
		4: [{
			f: 2,
			l: -2
		}, {
			f: 5,
			l: -9
		}],
		5: [{
			f: 6,
			l: 0
		}, {
			f: 7,
			l: 1.5
		}],
		1: [{
			f: 2,
			l: 3
		}, {
			f: 4,
			l: 6
		}]
	}, { throwAt: 1.65 }),
	play("corner", "Corner Strike", "Trips", TRIPS, "pass", "Corner route behind a sitting slot. Hold it one beat.", [
		3,
		4,
		2,
		1
	], {
		0: [{
			f: -1.8,
			l: .6
		}],
		3: [{
			f: 9,
			l: 0
		}, {
			f: 20,
			l: 8
		}],
		4: [{
			f: 6,
			l: .4
		}, {
			f: 6.5,
			l: 1
		}],
		5: [{
			f: 8,
			l: -2
		}, {
			f: 14,
			l: -6
		}],
		2: [{
			f: 12,
			l: 4
		}, {
			f: 16,
			l: 8
		}],
		1: [{
			f: 2,
			l: -5
		}, {
			f: 5,
			l: -6
		}]
	}, { throwAt: 2.05 }),
	play("post", "Play-Action Post", "I-Form", IFORM, "pass", "Sell the run. The post opens behind the safeties.", [
		2,
		5,
		3,
		1
	], {
		0: [{
			f: .8,
			l: 0
		}, {
			f: -2,
			l: -.4
		}],
		1: [{
			f: 4,
			l: 1.2
		}, {
			f: 6,
			l: 2
		}],
		4: [{
			f: 3,
			l: 1
		}, {
			f: 5,
			l: 2
		}],
		2: [{
			f: 10,
			l: .5
		}, {
			f: 24,
			l: 10
		}],
		5: [{
			f: 8,
			l: 1
		}, {
			f: 18,
			l: 9
		}],
		3: [{
			f: 12,
			l: -6
		}, {
			f: 14,
			l: -8
		}]
	}, {
		throwAt: 2.15,
		handoffAt: 99
	}),
	play("screen", "RB Screen", "Shotgun", GUN, "pass", "Let the rush climb, then throw behind it.", [1, 4], {
		0: [{
			f: -1.2,
			l: .2
		}],
		1: [
			{
				f: .2,
				l: -6
			},
			{
				f: 1.5,
				l: -14
			},
			{
				f: 8,
				l: -15
			},
			{
				f: 18,
				l: -12
			}
		],
		2: [{
			f: 4,
			l: 2
		}],
		3: [{
			f: 4,
			l: -1
		}],
		4: [{
			f: 5,
			l: -4
		}],
		6: [{
			f: 1,
			l: -2
		}, {
			f: 6,
			l: -8
		}],
		7: [{
			f: 1,
			l: -1
		}, {
			f: 6,
			l: -6
		}]
	}, { throwAt: 1.15 }),
	play("verts", "Four Verts", "Empty", EMPTY, "pass", "Stretch the top. Take the nearest window.", [
		2,
		3,
		5,
		4,
		1
	], {
		0: [{
			f: -2,
			l: 0
		}],
		2: [{
			f: 28,
			l: -1
		}, {
			f: 42,
			l: 0
		}],
		4: [{
			f: 26,
			l: 1
		}, {
			f: 40,
			l: 2
		}],
		5: [{
			f: 18,
			l: 0
		}, {
			f: 30,
			l: 1
		}],
		1: [{
			f: 22,
			l: -1
		}, {
			f: 36,
			l: 0
		}],
		3: [{
			f: 30,
			l: 1
		}, {
			f: 44,
			l: 0
		}]
	}, { throwAt: 2.35 }),
	play("hail", "Hail Mary", "Empty", EMPTY, "pass", "Everyone go. Throw it to the end zone.", [
		3,
		2,
		1,
		4
	], {
		0: [{
			f: -2.4,
			l: 0
		}],
		2: [{
			f: 46,
			l: -2
		}],
		4: [{
			f: 44,
			l: 0
		}],
		5: [{
			f: 40,
			l: 2
		}],
		1: [{
			f: 42,
			l: -1
		}],
		3: [{
			f: 48,
			l: 2
		}]
	}, { throwAt: 2.6 })
];
var NICKEL = [
	{
		d: 13,
		l: -2
	},
	{
		d: 5,
		l: -5.5
	},
	{
		d: 1.6,
		l: -22
	},
	{
		d: 1.6,
		l: 21
	},
	{
		d: 1.8,
		l: -12
	},
	{
		d: 5,
		l: 6
	},
	{
		d: 1.05,
		l: -6.5
	},
	{
		d: 1.05,
		l: -2.2
	},
	{
		d: 1.05,
		l: 2.2
	},
	{
		d: 1.05,
		l: 6.6
	},
	{
		d: 12,
		l: 10
	}
];
function def(id, name, blurb, align, jobs, man, zone, press = false) {
	return {
		id,
		name,
		blurb,
		align,
		jobs,
		man,
		zone,
		press
	};
}
var rush = (jobs, idxs) => {
	for (const i of idxs) jobs[i] = "rush";
};
var DEFENSE = [
	(() => {
		const jobs = Array(11).fill("zone");
		rush(jobs, [
			6,
			7,
			8,
			9
		]);
		return def("cover2", "Cover 2", "Safeties split the deep half. Corners wall the flats.", NICKEL, jobs, [
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1
		], [
			{
				f: 18,
				l: -12
			},
			{
				f: 7,
				l: -4
			},
			{
				f: 5,
				l: -20
			},
			{
				f: 5,
				l: 20
			},
			{
				f: 8,
				l: -10
			},
			{
				f: 7,
				l: 8
			},
			{
				f: 1,
				l: -6
			},
			{
				f: 1,
				l: -2
			},
			{
				f: 1,
				l: 2
			},
			{
				f: 1,
				l: 6
			},
			{
				f: 18,
				l: 12
			}
		]);
	})(),
	(() => {
		const jobs = Array(11).fill("zone");
		rush(jobs, [
			6,
			7,
			8,
			9
		]);
		return def("cover3", "Cover 3", "Three deep. A middle-field safety and soft corners.", NICKEL.map((s, i) => i === 2 || i === 3 ? {
			d: 8,
			l: s.l * .85
		} : i === 0 ? {
			d: 16,
			l: 0
		} : s), jobs, [
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1,
			-1
		], [
			{
				f: 22,
				l: 0
			},
			{
				f: 6,
				l: -6
			},
			{
				f: 16,
				l: -16
			},
			{
				f: 16,
				l: 16
			},
			{
				f: 7,
				l: -12
			},
			{
				f: 6,
				l: 7
			},
			{
				f: 1,
				l: -6
			},
			{
				f: 1,
				l: -2
			},
			{
				f: 1,
				l: 2
			},
			{
				f: 1,
				l: 6
			},
			{
				f: 9,
				l: 8
			}
		]);
	})(),
	(() => {
		return def("cover1", "Cover 1 Man", "Everybody's matched. One safety plays center field.", NICKEL.map((s, i) => i === 2 || i === 3 || i === 4 ? {
			d: 1.3,
			l: s.l
		} : s), [
			"zone",
			"man",
			"man",
			"man",
			"man",
			"man",
			"rush",
			"rush",
			"rush",
			"rush",
			"spy"
		], [
			-1,
			1,
			2,
			3,
			4,
			5,
			-1,
			-1,
			-1,
			-1,
			-1
		], [
			{
				f: 18,
				l: 0
			},
			{
				f: 4,
				l: 0
			},
			{
				f: 2,
				l: 0
			},
			{
				f: 2,
				l: 0
			},
			{
				f: 2,
				l: 0
			},
			{
				f: 3,
				l: 0
			},
			{
				f: 1,
				l: 0
			},
			{
				f: 1,
				l: 0
			},
			{
				f: 1,
				l: 0
			},
			{
				f: 1,
				l: 0
			},
			{
				f: 5,
				l: 0
			}
		]);
	})(),
	(() => {
		return def("cover0", "Cover 0 Blitz", "No deep help. The ball has to come out now.", NICKEL.map((s) => ({
			d: Math.min(s.d, 2.2),
			l: s.l * .92
		})), [
			"man",
			"rush",
			"man",
			"man",
			"man",
			"rush",
			"rush",
			"rush",
			"rush",
			"rush",
			"man"
		], [
			1,
			-1,
			2,
			3,
			4,
			-1,
			-1,
			-1,
			-1,
			-1,
			5
		], NICKEL.map(() => ({
			f: 2,
			l: 0
		})), true);
	})(),
	(() => {
		const align = [
			{
				d: 3,
				l: 0
			},
			{
				d: 1.4,
				l: -3
			},
			{
				d: 1.2,
				l: -10
			},
			{
				d: 1.2,
				l: 10
			},
			{
				d: 1.3,
				l: -6
			},
			{
				d: 1.4,
				l: 3.4
			},
			{
				d: .9,
				l: -5
			},
			{
				d: .9,
				l: -1.8
			},
			{
				d: .9,
				l: 1.8
			},
			{
				d: .9,
				l: 5
			},
			{
				d: 2.2,
				l: 6
			}
		];
		return def("goal", "Goal Line", "Bodies in the gap. Somebody is coming free.", align, [
			"zone",
			"rush",
			"man",
			"man",
			"man",
			"rush",
			"rush",
			"rush",
			"rush",
			"rush",
			"man"
		], [
			-1,
			-1,
			2,
			3,
			4,
			-1,
			-1,
			-1,
			-1,
			-1,
			5
		], align.map(() => ({
			f: 2,
			l: 0
		})), true);
	})()
];
var KICKS = [{
	id: "fg",
	name: "Field Goal",
	blurb: "Trust the snap. Time the meter."
}, {
	id: "punt",
	name: "Punt",
	blurb: "Flip the field. Touchback at the 25."
}];
function offById(id) {
	return OFFENSE.find((p) => p.id === id) ?? OFFENSE[0];
}
function defById(id) {
	return DEFENSE.find((p) => p.id === id) ?? DEFENSE[0];
}
function suggestOff(down, toGo, dist) {
	if (dist < 3) return "punch";
	if (toGo <= 2) return "zone";
	if (dist > 45 && toGo >= 18) return "hail";
	if (toGo >= 12) return "curl";
	if (down === 1) return "zone";
	if (down >= 3 && toGo >= 6) return "mesh";
	return "slant";
}
function suggestDef(down, toGo, dist) {
	if (dist < 3) return "goal";
	if (toGo <= 2) return "cover0";
	if (toGo >= 10) return "cover3";
	if (down >= 3) return "cover1";
	return "cover2";
}
function cpuOff(down, toGo, dist, r) {
	const bag = dist < 3 ? ["punch", "zone"] : toGo <= 2 ? [
		"zone",
		"power",
		"punch",
		"draw"
	] : toGo >= 12 ? [
		"verts",
		"post",
		"curl",
		"hail",
		"slant"
	] : [
		"slant",
		"mesh",
		"curl",
		"zone",
		"screen",
		"power",
		"corner",
		"toss",
		"post"
	];
	return bag[Math.floor(r * bag.length)] ?? "zone";
}
function cpuDef(down, toGo, dist, r) {
	if (dist < 3) return r < .7 ? "goal" : "cover0";
	if (toGo <= 2) return r < .55 ? "cover0" : "goal";
	if (toGo >= 10) return r < .5 ? "cover3" : "cover2";
	return r < .45 ? "cover1" : r < .75 ? "cover2" : "cover0";
}
var ACES$1 = [
	{
		num: 8,
		name: "VOSS",
		spd: 7.7,
		ol: false
	},
	{
		num: 28,
		name: "KANE",
		spd: 8.9,
		ol: false
	},
	{
		num: 11,
		name: "ITO",
		spd: 9.45,
		ol: false
	},
	{
		num: 17,
		name: "REYES",
		spd: 9.2,
		ol: false
	},
	{
		num: 21,
		name: "QUINN",
		spd: 8.7,
		ol: false
	},
	{
		num: 80,
		name: "BRAM",
		spd: 8.15,
		ol: false
	},
	{
		num: 70,
		name: "MOSS",
		spd: 6.7,
		ol: true
	},
	{
		num: 55,
		name: "HULL",
		spd: 6.3,
		ol: true
	},
	{
		num: 64,
		name: "BECK",
		spd: 6.2,
		ol: true
	},
	{
		num: 72,
		name: "DALE",
		spd: 6.6,
		ol: true
	},
	{
		num: 77,
		name: "OKAF",
		spd: 6.8,
		ol: true
	}
];
var KINGS$1 = [
	{
		num: 7,
		name: "NYX",
		spd: 7.8,
		ol: false
	},
	{
		num: 22,
		name: "LOCKE",
		spd: 8.75,
		ol: false
	},
	{
		num: 18,
		name: "VEGA",
		spd: 9.35,
		ol: false
	},
	{
		num: 13,
		name: "SHAY",
		spd: 9.15,
		ol: false
	},
	{
		num: 33,
		name: "ORR",
		spd: 8.6,
		ol: false
	},
	{
		num: 88,
		name: "PIKE",
		spd: 8.05,
		ol: false
	},
	{
		num: 91,
		name: "GRAV",
		spd: 6.8,
		ol: true
	},
	{
		num: 95,
		name: "TULL",
		spd: 6.4,
		ol: true
	},
	{
		num: 97,
		name: "WICK",
		spd: 6.3,
		ol: true
	},
	{
		num: 99,
		name: "BONE",
		spd: 6.7,
		ol: true
	},
	{
		num: 90,
		name: "KEST",
		spd: 6.9,
		ol: true
	}
];
var SIDELINE = 26.65;
var INK = "#07090c";
var TURF_A = "#0e1f19";
var TURF_B = "#13281f";
var ACES = "#2ee6c7";
var KINGS = "#ff5d73";
var BONE = "#f4f0e6";
var LINE = "rgba(223, 236, 228, 0.34)";
function createRenderer(canvas) {
	const crowd = Array.from({ length: 280 }, () => ({
		x: Math.random(),
		y: Math.random(),
		r: .7 + Math.random() * 2.2,
		a: .15 + Math.random() * .45,
		c: Math.random() < .5 ? "180, 230, 214" : "255, 170, 184"
	}));
	const sheets = {
		acesBack: loadImg("/sprites/aces-back.png"),
		acesFront: loadImg("/sprites/aces-front.png"),
		kingsBack: loadImg("/sprites/kings-back.png"),
		kingsFront: loadImg("/sprites/kings-front.png"),
		ball: loadImg("/sprites/ball.png"),
		turf: loadImg("/sprites/turf.jpg")
	};
	let turfPat = null;
	let camX = 60;
	let camY = 0;
	let zoom = 0;
	let rafT = 0;
	const project = (x, y, dir, scale, w, h) => {
		const viewUp = dir * (x - camX);
		const viewRight = dir * (y - camY);
		return {
			sx: w / 2 + viewRight * scale,
			sy: h * .58 - viewUp * scale,
			up: viewUp
		};
	};
	return function draw(s, dt, local) {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		rafT += dt;
		const live = s.phase === "live";
		const wide = Math.min(w / 62, h / 86);
		const tight = Math.min(w, h) / 34;
		const menuScale = Math.min(w / 78, h / 128);
		zoom += ((live ? 1 : 0) - zoom) * Math.min(1, dt * 1.6);
		let scale = s.phase === "menu" || s.phase === "lobby" ? menuScale : wide + (tight - wide) * zoom;
		scale = Math.max(4, scale);
		const ballP = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : void 0;
		const focusX = s.phase === "menu" || s.phase === "lobby" ? 60 : (ballP ? ballP.x : s.ball.x) + (live ? s.dir * 7 : s.dir * 2);
		const focusY = live ? (ballP ? ballP.y : s.ball.y) * .55 : 0;
		camX += (focusX - camX) * Math.min(1, dt * 2.8);
		camY += (focusY - camY) * Math.min(1, dt * 2.8);
		const shake = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false ? 0 : s.shake;
		const ox = Math.sin(rafT * 48) * shake * 7;
		const oy = Math.cos(rafT * 37) * shake * 5;
		ctx.fillStyle = INK;
		ctx.fillRect(0, 0, w, h);
		const standH = Math.max(36, h * .14);
		const grd = ctx.createLinearGradient(0, 0, 0, standH);
		grd.addColorStop(0, "#10151c");
		grd.addColorStop(1, "#0a100f");
		ctx.fillStyle = grd;
		ctx.fillRect(0, 0, w, standH);
		for (const c of crowd) {
			ctx.fillStyle = `rgba(${c.c}, ${c.a * .55})`;
			ctx.fillRect(c.x * w, 8 + c.y * (standH - 16), c.r, c.r + 2);
		}
		ctx.fillStyle = "rgba(46, 230, 199, 0.05)";
		ctx.beginPath();
		ctx.ellipse(w * .2, 0, w * .18, standH, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "rgba(255, 93, 115, 0.04)";
		ctx.beginPath();
		ctx.ellipse(w * .82, 0, w * .16, standH, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.save();
		ctx.translate(ox, oy);
		const dir = s.dir || 1;
		for (let x = 0; x < 120; x += 5) {
			const a = project(x, -32, dir, scale, w, h);
			const b = project(x + 5, 32, dir, scale, w, h);
			ctx.fillStyle = x / 5 % 2 === 0 ? TURF_A : TURF_B;
			ctx.fillRect(Math.min(a.sx, b.sx) - 40, Math.min(a.sy, b.sy), Math.abs(b.sx - a.sx) + 80, Math.abs(b.sy - a.sy));
		}
		if (sheets.turf.complete && sheets.turf.naturalWidth > 0) {
			turfPat ??= ctx.createPattern(sheets.turf, "repeat");
			if (turfPat) {
				ctx.save();
				ctx.beginPath();
				const poly = [
					project(0, -SIDELINE, dir, scale, w, h),
					project(120, -SIDELINE, dir, scale, w, h),
					project(120, SIDELINE, dir, scale, w, h),
					project(0, SIDELINE, dir, scale, w, h)
				];
				ctx.moveTo(poly[0].sx, poly[0].sy);
				for (const c of poly.slice(1)) ctx.lineTo(c.sx, c.sy);
				ctx.closePath();
				ctx.clip();
				ctx.globalAlpha = .34;
				ctx.fillStyle = turfPat;
				ctx.fillRect(0, 0, w, h);
				ctx.restore();
			}
		}
		paintZone(ctx, project, dir, scale, w, h, 0, 10, ACES, "ACES");
		paintZone(ctx, project, dir, scale, w, h, 110, 120, KINGS, "KINGS");
		ctx.strokeStyle = LINE;
		ctx.lineWidth = Math.max(1, scale * .06);
		for (let x = 10; x <= 110; x += 5) {
			const p1 = project(x, -SIDELINE, dir, scale, w, h);
			const p2 = project(x, SIDELINE, dir, scale, w, h);
			ctx.globalAlpha = x % 10 === 0 ? .55 : .22;
			ctx.beginPath();
			ctx.moveTo(p1.sx, p1.sy);
			ctx.lineTo(p2.sx, p2.sy);
			ctx.stroke();
		}
		ctx.globalAlpha = .7;
		for (const y of [-SIDELINE, SIDELINE]) {
			const p1 = project(0, y, dir, scale, w, h);
			const p2 = project(120, y, dir, scale, w, h);
			ctx.beginPath();
			ctx.moveTo(p1.sx, p1.sy);
			ctx.lineTo(p2.sx, p2.sy);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		ctx.fillStyle = "rgba(223,236,228,0.45)";
		ctx.font = `600 ${Math.max(9, scale * .95)}px Oswald, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		for (let yard = 10; yard <= 100; yard += 10) {
			const x = 10 + yard;
			const label = yard <= 50 ? String(yard) : String(100 - yard);
			for (const side of [-18, 18]) {
				const p = project(x, side, dir, scale, w, h);
				ctx.save();
				ctx.translate(p.sx, p.sy);
				ctx.rotate(dir === 1 ? -Math.PI / 2 : Math.PI / 2);
				ctx.globalAlpha = .28;
				ctx.fillText(label, 0, 0);
				ctx.restore();
			}
		}
		ctx.globalAlpha = .35;
		for (let x = 10; x <= 110; x += 1) for (const y of [-3.1, 3.1]) {
			const p = project(x, y, dir, scale, w, h);
			ctx.fillRect(p.sx - scale * .18, p.sy, scale * .36, Math.max(1, scale * .08));
		}
		ctx.globalAlpha = 1;
		drawPosts(ctx, project, dir, scale, w, h);
		if (s.phase !== "menu" && s.phase !== "lobby" && s.kind !== "return") {
			const los1 = project(s.los, -SIDELINE, dir, scale, w, h);
			const los2 = project(s.los, SIDELINE, dir, scale, w, h);
			ctx.strokeStyle = ACES;
			ctx.globalAlpha = .85;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(los1.sx, los1.sy);
			ctx.lineTo(los2.sx, los2.sy);
			ctx.stroke();
			const fx = s.los + s.dir * s.toGo;
			const f1 = project(fx, -SIDELINE, dir, scale, w, h);
			const f2 = project(fx, SIDELINE, dir, scale, w, h);
			ctx.strokeStyle = BONE;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			ctx.moveTo(f1.sx, f1.sy);
			ctx.lineTo(f2.sx, f2.sy);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
		}
		if ((s.phase === "presnap" || s.phase === "live") && local.team === s.poss && s.kind === "scrimmage") {
			const play = offById(s.offId);
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = ACES;
			ctx.globalAlpha = s.phase === "presnap" ? .75 : .25;
			ctx.setLineDash([4, 4]);
			for (let i = 0; i < 11; i++) {
				const pl = s.players[s.poss * 11 + i];
				const route = play.routes[i];
				if (!pl || !route || route.length === 0 || play.jobs[i] === "block") continue;
				ctx.beginPath();
				if (pl.path.length && s.simLocal) {
					const p0 = project(pl.x, pl.y, dir, scale, w, h);
					ctx.moveTo(p0.sx, p0.sy);
					for (const wp of pl.path.slice(pl.pi)) {
						const pp = project(wp.x, wp.y, dir, scale, w, h);
						ctx.lineTo(pp.sx, pp.sy);
					}
				} else {
					const p0 = project(pl.x, pl.y, dir, scale, w, h);
					ctx.moveTo(p0.sx, p0.sy);
					for (const wpt of route) {
						const pp = project(pl.x + dir * wpt.f, pl.y + dir * wpt.l, dir, scale, w, h);
						ctx.lineTo(pp.sx, pp.sy);
					}
				}
				ctx.stroke();
			}
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
		}
		if (s.phase === "presnap" && local.team !== s.poss && s.kind === "scrimmage") {
			const def = defById(s.defId);
			ctx.fillStyle = KINGS;
			for (let i = 0; i < 11; i++) {
				if (def.jobs[i] !== "zone") continue;
				const z = def.zone[i];
				if (!z) continue;
				const p = project(s.los + dir * z.f, dir * z.l, dir, scale, w, h);
				ctx.globalAlpha = .35;
				ctx.beginPath();
				ctx.arc(p.sx, p.sy, scale * 1.3, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		}
		const order = s.players.map((p) => ({
			p,
			sy: project(p.x, p.y, dir, scale, w, h).sy
		})).sort((a, b) => a.sy - b.sy);
		for (const { p } of order) {
			const pos = project(p.x, p.y, dir, scale, w, h);
			const controlled = p.id === s.ctrl[local.team] && s.human[local.team];
			const carrier = p.id === s.ball.carrier;
			ctx.fillStyle = "rgba(0,0,0,0.38)";
			ctx.beginPath();
			ctx.ellipse(pos.sx, pos.sy + scale * .08, scale * .55, scale * .22, 0, 0, Math.PI * 2);
			ctx.fill();
			const offense = p.team === s.poss;
			const img = p.team === 0 ? offense ? sheets.acesBack : sheets.acesFront : offense ? sheets.kingsBack : sheets.kingsFront;
			const frame = Math.hypot(p.vx, p.vy) > 1.1 ? Math.floor((rafT * 9 + p.id * .37) % 4) : 0;
			const cell = 128;
			const dw = scale * (p.ol ? 1.85 : 2.05);
			const dh = dw;
			ctx.save();
			ctx.translate(pos.sx, pos.sy);
			const lean = Math.max(-.35, Math.min(.35, dir * p.vy / 14));
			ctx.rotate(p.diving > 0 ? lean + dir * .7 : lean);
			if (img.complete && img.naturalWidth >= 64) ctx.drawImage(img, frame % 2 * cell, Math.floor(frame / 2) * cell, cell, cell, -dw / 2, -dh + scale * .18, dw, dh);
			else {
				ctx.fillStyle = p.team === 0 ? ACES : KINGS;
				ctx.beginPath();
				ctx.ellipse(0, -scale * .45, scale * .28, scale * .55, 0, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();
			if (controlled || carrier) {
				ctx.strokeStyle = controlled ? BONE : p.team === 0 ? ACES : KINGS;
				ctx.globalAlpha = controlled ? .9 : .45;
				ctx.lineWidth = controlled ? 2 : 1;
				ctx.beginPath();
				ctx.arc(pos.sx, pos.sy - scale * .7, scale * .95 + (controlled ? Math.sin(rafT * 5) * .6 : 0), 0, Math.PI * 2);
				ctx.stroke();
				ctx.globalAlpha = 1;
				if (controlled) {
					ctx.fillStyle = BONE;
					ctx.font = `700 ${Math.max(9, scale * .42)}px Oswald, sans-serif`;
					ctx.textAlign = "center";
					ctx.fillText(String(p.num), pos.sx, pos.sy + scale * .42);
				}
			}
		}
		const bx = s.ball.state === "held" && ballP ? ballP.x : s.ball.x;
		const by = s.ball.state === "held" && ballP ? ballP.y : s.ball.y;
		const bz = s.ball.state === "held" ? 1.35 : s.ball.z;
		const bp = project(bx, by, dir, scale, w, h);
		const lift = bz * scale * .85;
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		ctx.beginPath();
		ctx.ellipse(bp.sx + lift * .05, bp.sy + 2, scale * .28, scale * .12, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.save();
		ctx.translate(bp.sx, bp.sy - lift);
		if (s.ball.state === "air") ctx.rotate(Math.atan2(s.ball.vy, s.ball.vx));
		const ballImg = sheets.ball;
		if (ballImg.complete && ballImg.naturalWidth >= 64) {
			const bf = Math.floor(rafT * (s.ball.state === "air" ? 14 : 2)) % 4;
			const cell = 128;
			const bs = scale * (s.ball.state === "air" ? .95 : .72);
			ctx.drawImage(ballImg, bf % 2 * cell, Math.floor(bf / 2) * cell, cell, cell, -bs / 2, -bs / 2, bs, bs);
		} else {
			ctx.fillStyle = BONE;
			ctx.beginPath();
			ctx.ellipse(0, 0, scale * .34, scale * .2, 0, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		ctx.restore();
		const glow = ctx.createRadialGradient(w * .5, 0, 10, w * .5, h * .15, h * .55);
		glow.addColorStop(0, "rgba(244, 240, 230, 0.08)");
		glow.addColorStop(1, "rgba(244, 240, 230, 0)");
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, w, h);
		const vig = ctx.createRadialGradient(w / 2, h * .55, h * .2, w / 2, h * .5, h * .75);
		vig.addColorStop(0, "rgba(0,0,0,0)");
		vig.addColorStop(1, "rgba(0,0,0,0.45)");
		ctx.fillStyle = vig;
		ctx.fillRect(0, 0, w, h);
	};
}
function loadImg(src) {
	const img = new Image();
	img.decoding = "async";
	img.src = src;
	return img;
}
function drawPosts(ctx, project, dir, scale, w, h) {
	ctx.strokeStyle = "rgba(244, 240, 230, 0.78)";
	ctx.lineWidth = Math.max(1.5, scale * .07);
	ctx.lineCap = "round";
	for (const x of [1.2, 118.8]) {
		const left = project(x, -3.05, dir, scale, w, h);
		const right = project(x, 3.05, dir, scale, w, h);
		const rise = scale * 5.2;
		ctx.beginPath();
		ctx.moveTo(left.sx, left.sy);
		ctx.lineTo(left.sx, left.sy - rise);
		ctx.moveTo(right.sx, right.sy);
		ctx.lineTo(right.sx, right.sy - rise);
		ctx.moveTo(left.sx, left.sy - rise * .42);
		ctx.lineTo(right.sx, right.sy - rise * .42);
		ctx.stroke();
	}
}
function paintZone(ctx, project, dir, scale, w, h, x0, x1, color, label) {
	const corners = [
		project(x0, -SIDELINE - 1, dir, scale, w, h),
		project(x1, -SIDELINE - 1, dir, scale, w, h),
		project(x1, SIDELINE + 1, dir, scale, w, h),
		project(x0, SIDELINE + 1, dir, scale, w, h)
	];
	ctx.fillStyle = color;
	ctx.globalAlpha = .16;
	ctx.beginPath();
	ctx.moveTo(corners[0].sx, corners[0].sy);
	for (const c of corners.slice(1)) ctx.lineTo(c.sx, c.sy);
	ctx.closePath();
	ctx.fill();
	const mid = project((x0 + x1) / 2, 0, dir, scale, w, h);
	ctx.globalAlpha = .55;
	ctx.fillStyle = color;
	ctx.font = `700 ${Math.max(14, scale * 2.1)}px Oswald, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(label, mid.sx, mid.sy);
	ctx.globalAlpha = 1;
}
var ctx = null;
var master = null;
var sfxBus = null;
var crowdBus = null;
var cheer = null;
var noiseBuf = null;
var started = false;
var muted = false;
var volume = .85;
var energy = .12;
var target = .12;
function curve(v) {
	return v * v;
}
function ensure() {
	if (typeof window === "undefined") return null;
	if (!ctx) {
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return null;
		ctx = new AC({ latencyHint: "interactive" });
		master = ctx.createGain();
		sfxBus = ctx.createGain();
		crowdBus = ctx.createGain();
		sfxBus.gain.value = .9;
		crowdBus.gain.value = .85;
		sfxBus.connect(master);
		crowdBus.connect(master);
		master.connect(ctx.destination);
		master.gain.value = muted ? 0 : curve(volume);
		const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const data = n.getChannelData(0);
		let b = 0;
		for (let i = 0; i < data.length; i++) {
			const w = Math.random() * 2 - 1;
			b = b * .96 + w * .04;
			data[i] = w * .65 + b * 6;
		}
		noiseBuf = n;
	}
	return ctx;
}
function unlockAudio() {
	const c = ensure();
	if (c && c.state === "suspended") c.resume();
	startCrowd();
}
function setMuted(next) {
	muted = next;
	if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : curve(volume), ctx.currentTime, .03);
}
function isMuted() {
	return muted;
}
function resumeAudio() {
	if (ctx && ctx.state === "suspended") ctx.resume();
}
/** 0 idle stands, 1 a full roar. Decays toward the phase bed. */
function pumpCrowd(n) {
	energy = Math.max(energy, Math.max(0, Math.min(1, n)));
}
function setCrowdBed(n) {
	target = Math.max(.04, Math.min(.55, n));
}
function tickAudio(dt) {
	if (!ctx || !cheer) return;
	energy += (target - energy) * Math.min(1, dt * 1.4);
	cheer.gain.setTargetAtTime(.012 + energy * .16, ctx.currentTime, .06);
}
function startCrowd() {
	if (!ctx || !noiseBuf || !crowdBus || started) return;
	started = true;
	const bed = ctx.createBufferSource();
	bed.buffer = noiseBuf;
	bed.loop = true;
	const low = ctx.createBiquadFilter();
	low.type = "lowpass";
	low.frequency.value = 520;
	const bedGain = ctx.createGain();
	bedGain.gain.value = .045;
	bed.connect(low);
	low.connect(bedGain);
	bedGain.connect(crowdBus);
	bed.start();
	const roar = ctx.createBufferSource();
	roar.buffer = noiseBuf;
	roar.loop = true;
	const mid = ctx.createBiquadFilter();
	mid.type = "bandpass";
	mid.frequency.value = 1400;
	mid.Q.value = .55;
	cheer = ctx.createGain();
	cheer.gain.value = .02;
	roar.connect(mid);
	mid.connect(cheer);
	cheer.connect(crowdBus);
	roar.start();
	const lfo = ctx.createOscillator();
	lfo.frequency.value = .18;
	const lfoGain = ctx.createGain();
	lfoGain.gain.value = 90;
	lfo.connect(lfoGain);
	lfoGain.connect(mid.frequency);
	lfo.start();
}
function envGain(at, peak, dur, attack = .012) {
	if (!ctx || !sfxBus) return null;
	const g = ctx.createGain();
	g.connect(sfxBus);
	g.gain.setValueAtTime(1e-4, at);
	g.gain.exponentialRampToValueAtTime(Math.max(.001, peak), at + attack);
	g.gain.exponentialRampToValueAtTime(1e-4, at + dur);
	return g;
}
function tone(freq, dur, type, peak, slide = 0, attack = .012) {
	if (!ctx) return;
	const at = ctx.currentTime;
	const g = envGain(at, peak, dur, attack);
	if (!g) return;
	const o = ctx.createOscillator();
	o.type = type;
	o.frequency.setValueAtTime(Math.max(40, freq), at);
	if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), at + dur * .9);
	o.connect(g);
	o.start(at);
	o.stop(at + dur + .02);
	o.onended = () => {
		o.disconnect();
		g.disconnect();
	};
}
function burst(dur, peak, freq, q = .7, type = "bandpass") {
	if (!ctx || !noiseBuf) return;
	const at = ctx.currentTime;
	const g = envGain(at, peak, dur, .006);
	if (!g) return;
	const src = ctx.createBufferSource();
	src.buffer = noiseBuf;
	const filter = ctx.createBiquadFilter();
	filter.type = type;
	filter.frequency.value = freq;
	filter.Q.value = q;
	src.connect(filter);
	filter.connect(g);
	src.start(at);
	src.stop(at + dur);
	src.onended = () => {
		src.disconnect();
		filter.disconnect();
		g.disconnect();
	};
}
function whistle() {
	if (!ctx) return;
	const at = ctx.currentTime;
	const g = envGain(at, .07, .42, .03);
	if (!g) return;
	const a = ctx.createOscillator();
	const b = ctx.createOscillator();
	a.type = "sine";
	b.type = "sine";
	a.frequency.setValueAtTime(3180, at);
	b.frequency.setValueAtTime(3340, at);
	a.frequency.linearRampToValueAtTime(3360, at + .28);
	b.frequency.linearRampToValueAtTime(3520, at + .28);
	a.connect(g);
	b.connect(g);
	a.start(at);
	b.start(at);
	a.stop(at + .46);
	b.stop(at + .46);
	burst(.08, .03, 5e3, .4, "highpass");
	a.onended = () => {
		a.disconnect();
		b.disconnect();
		g.disconnect();
	};
}
function thud(low) {
	tone(low, .16, "sine", .28, -low * .55, .004);
	tone(low * 1.5, .08, "triangle", .08, -40, .004);
	burst(.12, .22, 180, .6);
	burst(.05, .12, 2400, .8, "highpass");
}
function playSfx(name) {
	if (!ensure() || muted || !name) return;
	const wobble = .94 + Math.random() * .12;
	switch (name) {
		case "snap":
			burst(.05, .28, 2200, .9, "highpass");
			burst(.09, .16, 240, .5);
			tone(180, .06, "sine", .1, -40, .004);
			pumpCrowd(.32);
			break;
		case "pass":
			burst(.16, .1, 1600, .45);
			tone(420 * wobble, .12, "triangle", .05, 220, .01);
			burst(.08, .06, 700, 1.2);
			break;
		case "kick":
			thud(70);
			burst(.18, .08, 900, .4);
			tone(160, .2, "sine", .08, 80);
			pumpCrowd(.4);
			break;
		case "catch":
			burst(.06, .2, 1800, .8);
			tone(540 * wobble, .07, "sine", .08);
			burst(.1, .1, 400, .5);
			pumpCrowd(.62);
			break;
		case "inc":
			tone(240, .16, "sine", .06, -90);
			burst(.14, .1, 280, .5);
			thud(55);
			break;
		case "hit":
			thud(78);
			tone(140, .1, "square", .04, -60, .004);
			pumpCrowd(.58);
			break;
		case "tackle":
			thud(64);
			burst(.18, .16, 140, .45);
			pumpCrowd(.5);
			break;
		case "juke":
			tone(480 * wobble, .05, "square", .035, 180, .004);
			burst(.05, .05, 2e3, 1);
			break;
		case "whistle":
			whistle();
			break;
		case "first":
			tone(523, .09, "triangle", .07);
			tone(659, .12, "triangle", .07);
			tone(784, .16, "sine", .05);
			pumpCrowd(.7);
			break;
		case "td":
			tone(196, .22, "sawtooth", .04);
			tone(262, .28, "triangle", .06);
			tone(392, .34, "triangle", .06);
			tone(523, .42, "sine", .05);
			burst(.35, .08, 500, .4);
			pumpCrowd(1);
			break;
		case "int":
			tone(440, .1, "square", .045, -80);
			tone(330, .18, "square", .04, -40);
			burst(.12, .1, 700, .6);
			pumpCrowd(.75);
			break;
		case "miss":
			tone(220, .2, "sine", .06, -80);
			tone(175, .28, "triangle", .04, -30);
			burst(.16, .06, 300, .4);
	}
}
var neutralPad = () => ({
	ax: 0,
	ay: 0,
	snap: false,
	throwTo: null,
	juke: false,
	dive: false,
	switch: false
});
var emptyStats = () => ({
	rush: 0,
	pass: 0,
	td: 0,
	sack: 0,
	takeaway: 0,
	fg: 0
});
function rng(s) {
	s.seed = Math.imul(s.seed, 1664525) + 1013904223 >>> 0;
	return s.seed / 4294967296;
}
function makePlayer(team, idx) {
	const a = (team === 0 ? ACES$1 : KINGS$1)[idx];
	return {
		id: team * 11 + idx,
		team,
		idx,
		num: a.num,
		name: a.name,
		spd: a.spd,
		ol: a.ol,
		x: 60,
		y: (idx - 5) * 3,
		vx: 0,
		vy: 0,
		tx: 60,
		ty: 0,
		mode: "idle",
		path: [],
		pi: 0,
		man: -1,
		zx: 60,
		zy: 0,
		down: false,
		grip: 0,
		shed: 0,
		juke: 0,
		jukeCd: 0,
		diving: 0,
		blockT: 0
	};
}
function makeBall() {
	return {
		x: 35,
		y: 0,
		z: 1.2,
		vx: 0,
		vy: 0,
		vz: 0,
		tx: 35,
		ty: 0,
		tz: 1.2,
		carrier: 1,
		state: "held",
		flight: 0,
		hang: .8
	};
}
function createMatch() {
	const players = [];
	for (const team of [0, 1]) for (let i = 0; i < 11; i++) players.push(makePlayer(team, i));
	return {
		phase: "menu",
		simLocal: true,
		online: false,
		myTeam: 0,
		human: [true, false],
		sharp: false,
		q: 1,
		clock: 360,
		clockRunning: true,
		freeze: false,
		playClock: 20,
		down: 1,
		toGo: 10,
		los: 35,
		dir: 1,
		poss: 0,
		score: [0, 0],
		players,
		ball: makeBall(),
		ctrl: [1, 15],
		chosen: [null, null],
		offId: "zone",
		defId: "cover2",
		kind: "return",
		liveT: 0,
		startLos: 35,
		thrown: false,
		handed: false,
		twoPt: false,
		patTeam: 0,
		banner: "",
		sub: "",
		deadT: 0,
		queue: null,
		fg: null,
		log: [],
		stats: [emptyStats(), emptyStats()],
		shake: 0,
		sfx: "",
		sfxN: 0,
		seed: 20973,
		paused: false,
		snapN: 0,
		seen: false,
		lastN: 0,
		endNote: ""
	};
}
function viewYaw(dir, vx, vy) {
	return Math.atan2(-(dir * vy), dir * vx);
}
function distGoal(team, x) {
	return team === 0 ? 110 - x : x - 10;
}
function spotName(x) {
	const fromLeft = x - 10;
	if (fromLeft >= 49 && fromLeft <= 51) return "50";
	const yard = fromLeft <= 50 ? fromLeft : 100 - fromLeft;
	return `${fromLeft < 50 ? "ACES" : "KINGS"} ${Math.max(1, Math.round(yard))}`;
}
function downText(s) {
	const names = [
		"",
		"1ST",
		"2ND",
		"3RD",
		"4TH"
	];
	const tg = distGoal(s.poss, s.los) <= s.toGo + .2 ? "GOAL" : String(Math.max(1, Math.round(s.toGo)));
	return `${names[s.down] ?? "1ST"} & ${tg}`;
}
function P(s, team, idx) {
	return s.players[team * 11 + idx];
}
function dist(ax, ay, bx, by) {
	return Math.hypot(ax - bx, ay - by);
}
function clamp(n, a, b) {
	return Math.max(a, Math.min(b, n));
}
function say(s, banner, sub = "") {
	s.banner = banner;
	s.sub = sub;
	if (banner) {
		s.log.unshift(sub ? `${banner} · ${sub}` : banner);
		s.log.length = 7;
	}
}
function sfx(s, name) {
	s.sfx = name;
	s.sfxN += 1;
}
function own25(team) {
	return team === 0 ? 35 : 85;
}
function beginSolo(s, sharp = false) {
	const fresh = createMatch();
	Object.assign(s, fresh, {
		players: s.players,
		ball: s.ball,
		stats: s.stats,
		log: s.log
	});
	s.players.splice(0, s.players.length, ...fresh.players);
	Object.assign(s.ball, fresh.ball);
	s.stats[0] = emptyStats();
	s.stats[1] = emptyStats();
	s.log.length = 0;
	s.sharp = sharp;
	s.human = [true, false];
	s.myTeam = 0;
	s.simLocal = true;
	s.online = false;
	s.seed = (Date.now() ^ 2654435769) >>> 0;
	setupReturn(s, 0, 30);
	say(s, "KICKOFF", "Bring it out");
	sfx(s, "whistle");
}
function armOnline(s, myTeam, simLocal) {
	const fresh = createMatch();
	s.players.splice(0, s.players.length, ...fresh.players);
	Object.assign(s.ball, fresh.ball);
	Object.assign(s, {
		...fresh,
		players: s.players,
		ball: s.ball,
		stats: [emptyStats(), emptyStats()],
		log: [],
		myTeam,
		simLocal,
		online: true,
		human: [true, true],
		phase: "lobby",
		seed: (Date.now() ^ (myTeam + 1) * 997) >>> 0
	});
}
function hostKickoff(s) {
	s.score = [0, 0];
	s.q = 1;
	s.clock = 360;
	s.stats = [emptyStats(), emptyStats()];
	s.log = [];
	s.twoPt = false;
	setupReturn(s, 0, 30);
	say(s, "KICKOFF", "Ridge receives");
	sfx(s, "whistle");
}
function setupReturn(s, receiving, spot) {
	const dir = receiving === 0 ? 1 : -1;
	s.poss = receiving;
	s.dir = dir;
	s.los = spot;
	s.down = 1;
	s.toGo = 10;
	s.kind = "return";
	s.phase = "live";
	s.liveT = 0;
	s.thrown = false;
	s.handed = false;
	s.startLos = spot;
	s.twoPt = false;
	s.fg = null;
	s.clockRunning = true;
	s.freeze = false;
	const ySpread = [
		-16,
		-10,
		-6,
		-2,
		2,
		6,
		10,
		16,
		-13,
		13,
		0
	];
	for (let i = 0; i < 11; i++) {
		const rec = P(s, receiving, i);
		const cov = P(s, 1 - receiving, i);
		resetAthlete(rec);
		resetAthlete(cov);
		if (i === 1) {
			rec.x = spot;
			rec.y = 0;
			rec.mode = "route";
			rec.path = [
				{
					x: spot + dir * 12,
					y: 2
				},
				{
					x: spot + dir * 28,
					y: -4
				},
				{
					x: spot + dir * 55,
					y: 0
				}
			];
		} else {
			rec.x = spot + dir * 2.5;
			rec.y = (ySpread[i] ?? 0) * .7;
			rec.mode = "block";
			rec.path = [{
				x: rec.x + dir * 8,
				y: rec.y
			}];
		}
		cov.x = spot + dir * (16 + i % 3);
		cov.y = (i - 5) * 4.6;
		cov.y = clamp(cov.y, -24, 24);
		cov.mode = "pursue";
	}
	const carrier = P(s, receiving, 1);
	s.ball.state = "held";
	s.ball.carrier = carrier.id;
	s.ball.x = carrier.x;
	s.ball.y = carrier.y;
	s.ball.z = 1.3;
	s.ctrl[receiving] = carrier.id;
	s.ctrl[1 - receiving] = (1 - receiving) * 11 + 2;
	s.queue = null;
}
function resetAthlete(p) {
	p.vx = 0;
	p.vy = 0;
	p.mode = "idle";
	p.path = [];
	p.pi = 0;
	p.man = -1;
	p.down = false;
	p.grip = 0;
	p.shed = 0;
	p.juke = 0;
	p.diving = 0;
	p.blockT = 0;
}
function lineup(s) {
	const off = offById(s.offId);
	const def = defById(s.defId);
	const dir = s.dir;
	const los = s.los;
	for (let i = 0; i < 11; i++) {
		const o = P(s, s.poss, i);
		const d = P(s, 1 - s.poss, i);
		resetAthlete(o);
		resetAthlete(d);
		const os = off.align[i] ?? {
			d: 1,
			l: 0
		};
		const ds = def.align[i] ?? {
			d: 2,
			l: 0
		};
		o.x = los - dir * os.d;
		o.y = dir * os.l;
		d.x = los + dir * ds.d;
		d.y = dir * ds.l;
		o.y = clamp(o.y, -25.5, 25.5);
		d.y = clamp(d.y, -25.5, 25.5);
		o.path = (off.routes[i] ?? []).map((w) => ({
			x: o.x + dir * w.f,
			y: o.y + dir * w.l
		}));
		o.mode = off.jobs[i] === "block" ? "block" : "route";
		const job = def.jobs[i] ?? "zone";
		d.mode = job === "rush" ? "rush" : job === "man" ? "man" : job === "spy" ? "spy" : "zone";
		const manIdx = def.man[i] ?? -1;
		d.man = manIdx >= 0 ? s.poss * 11 + manIdx : -1;
		const z = def.zone[i] ?? {
			f: 6,
			l: 0
		};
		d.zx = los + dir * z.f;
		d.zy = dir * z.l;
	}
	const qb = P(s, s.poss, 0);
	s.ball.state = "held";
	s.ball.carrier = qb.id;
	s.ball.x = qb.x;
	s.ball.y = qb.y;
	s.ball.z = 1.4;
	s.ctrl[s.poss] = qb.id;
	autoDef(s, 1 - s.poss);
	s.thrown = false;
	s.handed = off.group === "run" && off.handoffAt > 20;
	s.kind = "scrimmage";
	s.liveT = 0;
	s.startLos = s.los;
}
function autoDef(s, team) {
	const ball = s.ball;
	let best = team * 11 + 4;
	let bd = 1e9;
	for (const i of [
		4,
		1,
		5,
		2,
		3,
		0,
		10
	]) {
		const p = P(s, team, i);
		const d = dist(p.x, p.y, ball.x, ball.y) + (p.ol ? 8 : 0);
		if (d < bd) {
			bd = d;
			best = p.id;
		}
	}
	s.ctrl[team] = best;
}
function maybePresnap(s) {
	if (s.chosen[0] && s.chosen[1] && s.phase === "call") {
		const offTeam = s.poss;
		const defTeam = 1 - s.poss;
		const offChoice = s.chosen[offTeam];
		const defChoice = s.chosen[defTeam];
		if (offChoice === "fg") {
			startKick(s, offTeam, "fg");
			return;
		}
		if (offChoice === "punt") {
			doPunt(s);
			return;
		}
		s.offId = offChoice;
		s.defId = defChoice;
		lineup(s);
		s.phase = "presnap";
		s.liveT = 0;
		say(s, "SET", offById(offChoice).formation);
	}
}
function choosePlay(s, team, id) {
	if (s.phase !== "call") return;
	const offense = team === s.poss;
	if (offense && id !== "fg" && id !== "punt" && !offById(id)) return;
	if (!offense && id !== "fg" && id !== "punt") s.chosen[team] = defById(id).id;
	else if (offense) s.chosen[team] = id;
	else return;
	if (!offense && (id === "fg" || id === "punt")) return;
	maybePresnap(s);
}
function enterCall(s) {
	s.phase = "call";
	s.playClock = s.twoPt ? 12 : 20;
	s.chosen = [null, null];
	s.fg = null;
	s.banner = s.twoPt ? "TWO-POINT TRY" : s.banner;
	for (const team of [0, 1]) if (!s.human[team]) s.chosen[team] = cpuPick(s, team);
	maybePresnap(s);
}
function cpuPick(s, team) {
	const dist = distGoal(s.poss, s.los);
	const r = rng(s);
	if (team === s.poss) {
		if (!s.twoPt && s.down === 4) {
			if (dist < 38 && dist > 12) return r < .62 ? "fg" : cpuOff(s.down, s.toGo, dist, r);
			if (dist >= 38) return r < .75 ? "punt" : cpuOff(s.down, s.toGo, dist, r);
		}
		return cpuOff(s.down, s.toGo, dist, r);
	}
	return cpuDef(s.down, s.toGo, dist, r);
}
function giveBall(s, team, x, first) {
	s.poss = team;
	s.dir = team === 0 ? 1 : -1;
	const goal = distGoal(team, x);
	const clamped = clamp(clamp(x, team === 0 ? 12 : 12, team === 0 ? 108 : 108), 11, 109);
	s.los = clamped;
	s.down = 1;
	s.toGo = first ? Math.min(10, Math.max(.5, distGoal(team, clamped))) : Math.min(10, goal);
	if (!first) s.toGo = Math.min(10, distGoal(team, clamped));
	s.clockRunning = true;
}
function applyQueue(s) {
	const q = s.queue;
	s.queue = null;
	if (!q || q.t === "final") {
		s.phase = "final";
		s.endNote = s.score[0] === s.score[1] ? "Tie game" : s.score[0] > s.score[1] ? "Ridge Aces win" : "Vesper Kings win";
		sfx(s, "whistle");
		return;
	}
	if (q.t === "pat") {
		s.phase = "pat";
		say(s, "TOUCHDOWN", "Kick or go for two");
		return;
	}
	if (q.t === "ko") {
		setupReturn(s, q.team ?? 0, q.team === 1 ? 90 : 30);
		say(s, "KICKOFF", `${q.team === 0 ? "Aces" : "Kings"} receive`);
		sfx(s, "whistle");
		return;
	}
	if (q.t === "ball" || q.t === "spot" || q.t === "call") {
		if (q.t === "ball" && q.team !== void 0 && q.x !== void 0) giveBall(s, q.team, q.x, true);
		else if (q.x !== void 0) {
			const team = s.poss;
			s.los = clamp(q.x, 11, 109);
			if (q.first) {
				s.down = 1;
				s.toGo = Math.min(10, Math.max(.5, distGoal(team, s.los)));
			}
			s.dir = team === 0 ? 1 : -1;
		}
		if (quarterOver(s)) return;
		enterCall(s);
	}
}
function quarterOver(s) {
	if (s.clock > 0) return false;
	s.clock = 0;
	if (s.q < 4) {
		s.q += 1;
		s.clock = 360;
		s.clockRunning = s.q !== 3;
		if (s.q === 3) say(s, "HALFTIME", "Third quarter next");
		return false;
	}
	if (s.q === 4 && s.score[0] === s.score[1]) {
		s.q = 5;
		s.clock = 300;
		s.clockRunning = true;
		say(s, "OVERTIME", "Next score wins");
		return false;
	}
	if (s.q >= 4 && s.score[0] !== s.score[1]) {
		s.queue = { t: "final" };
		s.phase = "dead";
		s.deadT = .2;
		return true;
	}
	if (s.q >= 5) {
		s.queue = { t: "final" };
		s.phase = "dead";
		s.deadT = .2;
		return true;
	}
	return false;
}
function scoreTD(s, team) {
	if (s.twoPt) {
		s.score[team] += 2;
		s.stats[team].td += 1;
		say(s, "TWO-POINT GOOD", `${team === 0 ? "Aces" : "Kings"} +2`);
		s.shake = .8;
		sfx(s, "td");
		finishScore(s, team, true);
		return;
	}
	s.score[team] += 6;
	s.stats[team].td += 1;
	say(s, "TOUCHDOWN", `${P(s, team, s.ball.carrier >= 0 ? s.players[s.ball.carrier].idx : 0).name}`);
	s.shake = 1;
	sfx(s, "td");
	if (s.q >= 5) {
		s.queue = { t: "final" };
		s.phase = "dead";
		s.deadT = 0;
		return;
	}
	s.patTeam = team;
	s.twoPt = false;
	s.queue = { t: "pat" };
	s.phase = "dead";
	s.deadT = 0;
}
function finishScore(s, scoring, kickoff) {
	if (s.q >= 5) {
		s.queue = { t: "final" };
		s.phase = "dead";
		s.deadT = 0;
		return;
	}
	s.twoPt = false;
	if (kickoff) {
		s.queue = {
			t: "ko",
			team: 1 - scoring
		};
		s.phase = "dead";
		s.deadT = 0;
	}
}
function scoreSafety(s, scoring) {
	s.score[scoring] += 2;
	say(s, "SAFETY", `${scoring === 0 ? "Aces" : "Kings"} +2`);
	s.shake = .7;
	sfx(s, "hit");
	if (s.q >= 5) {
		s.queue = { t: "final" };
		s.phase = "dead";
		s.deadT = 0;
		return;
	}
	s.queue = {
		t: "ball",
		team: scoring,
		x: own25(scoring)
	};
	s.phase = "dead";
	s.deadT = 0;
	s.clockRunning = false;
}
function startKick(s, team, kind) {
	const dir = team === 0 ? 1 : -1;
	if (kind === "xp") s.los = team === 0 ? 95 : 25;
	const toGoal = Math.abs((dir === 1 ? 110 : 10) - s.los);
	const dist = Math.round(toGoal + 17);
	s.fg = {
		team,
		dist,
		kind,
		t: 0
	};
	s.phase = "fg";
	s.twoPt = false;
	say(s, kind === "xp" ? "EXTRA POINT" : `${dist} YARD FIELD GOAL`, "Time the bar");
}
function startTwo(s) {
	const team = s.patTeam;
	s.twoPt = true;
	s.poss = team;
	s.dir = team === 0 ? 1 : -1;
	s.los = team === 0 ? 108 : 12;
	s.down = 1;
	s.toGo = 2;
	s.clockRunning = false;
	enterCall(s);
	say(s, "TWO-POINT TRY", "From the 2");
}
function resolveKick(s, accuracy) {
	if (s.phase !== "fg" || !s.fg) return;
	const kick = s.fg;
	const sweet = kick.dist < 30 ? .3 : kick.dist < 40 ? .2 : kick.dist < 50 ? .12 : .07;
	if (Math.abs(accuracy) < sweet) {
		const pts = kick.kind === "xp" ? 1 : 3;
		s.score[kick.team] += pts;
		if (kick.kind === "fg") s.stats[kick.team].fg += 1;
		say(s, kick.kind === "xp" ? "EXTRA POINT" : "FIELD GOAL", `${kick.dist} yards`);
		sfx(s, "td");
		s.shake = .45;
		if (s.q >= 5 && kick.kind === "fg") {
			s.queue = { t: "final" };
			s.phase = "dead";
			s.deadT = 0;
			s.fg = null;
			return;
		}
	} else {
		say(s, "NO GOOD", kick.kind === "xp" ? "Extra point missed" : `${kick.dist} yards`);
		sfx(s, "miss");
		if (kick.kind === "fg") {
			const recv = 1 - kick.team;
			s.fg = null;
			s.queue = {
				t: "ball",
				team: recv,
				x: clamp(s.los, 11, 109)
			};
			s.phase = "dead";
			s.deadT = 0;
			s.clockRunning = false;
			return;
		}
	}
	s.fg = null;
	s.twoPt = false;
	s.queue = {
		t: "ko",
		team: 1 - kick.team
	};
	s.phase = "dead";
	s.deadT = 0;
}
function doPunt(s) {
	const net = 36 + rng(s) * 12;
	const land = s.los + s.dir * net;
	const recv = 1 - s.poss;
	const crossed = s.dir === 1 ? land >= 110 : land <= 10;
	s.clock = Math.max(0, s.clock - 6);
	if (crossed) {
		say(s, "TOUCHBACK", `${recv === 0 ? "Aces" : "Kings"} ball at the 25`);
		sfx(s, "whistle");
		s.queue = {
			t: "ball",
			team: recv,
			x: own25(recv)
		};
		s.phase = "dead";
		s.deadT = 0;
		s.clockRunning = false;
		return;
	}
	setupReturn(s, recv, clamp(land, 18, 102));
	say(s, "PUNT", `${Math.round(net)} yard kick`);
	sfx(s, "kick");
}
function whistleIncomplete(s) {
	s.ball.state = "dead";
	s.ball.z = 0;
	s.clockRunning = false;
	if (s.twoPt) {
		say(s, "NO GOOD", "Two-point fails");
		sfx(s, "inc");
		s.queue = {
			t: "ko",
			team: 1 - s.poss
		};
		s.twoPt = false;
		s.phase = "dead";
		s.deadT = 0;
		return;
	}
	s.down += 1;
	say(s, "INCOMPLETE", downText(s));
	sfx(s, "inc");
	if (s.down > 4) {
		const recv = 1 - s.poss;
		say(s, "TURNOVER ON DOWNS", spotName(s.los));
		s.queue = {
			t: "ball",
			team: recv,
			x: s.los
		};
	} else s.queue = {
		t: "spot",
		x: s.los
	};
	s.phase = "dead";
	s.deadT = 0;
}
function whistleDown(s, why) {
	const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : void 0;
	if (!carrier) {
		whistleIncomplete(s);
		return;
	}
	if (carrier.team === 0 && carrier.x >= 110 || carrier.team === 1 && carrier.x <= 10) {
		scoreTD(s, carrier.team);
		return;
	}
	if (carrier.team === 0 ? carrier.x <= 10 : carrier.x >= 110) {
		if (s.kind === "return") {
			say(s, "TOUCHBACK", "Ball at the 25");
			sfx(s, "whistle");
			s.queue = {
				t: "ball",
				team: carrier.team,
				x: own25(carrier.team)
			};
			s.phase = "dead";
			s.deadT = 0;
			s.clockRunning = false;
			return;
		}
		scoreSafety(s, 1 - carrier.team);
		return;
	}
	if (s.kind === "return") {
		const spot = clamp(carrier.x, 11, 109);
		say(s, "TACKLED", spotName(spot));
		sfx(s, "hit");
		s.shake = .35;
		s.queue = {
			t: "ball",
			team: carrier.team,
			x: spot
		};
		s.phase = "dead";
		s.deadT = 0;
		s.clockRunning = why !== "oob";
		return;
	}
	if (carrier.team !== s.poss) {
		const spot = clamp(carrier.x, 11, 109);
		say(s, s.thrown ? "INTERCEPTION" : "FUMBLE", spotName(spot));
		s.stats[carrier.team].takeaway += 1;
		sfx(s, "int");
		s.shake = .55;
		s.queue = {
			t: "ball",
			team: carrier.team,
			x: spot
		};
		s.phase = "dead";
		s.deadT = 0;
		s.clockRunning = why !== "oob";
		return;
	}
	if (s.twoPt) {
		say(s, "NO GOOD", "Stopped short");
		sfx(s, "hit");
		s.twoPt = false;
		s.queue = {
			t: "ko",
			team: 1 - s.poss
		};
		s.phase = "dead";
		s.deadT = 0;
		return;
	}
	const spot = clamp(carrier.x, 11, 109);
	const gain = s.dir * (spot - s.startLos);
	if (s.thrown && s.handed) s.stats[s.poss].pass += gain;
	else s.stats[s.poss].rush += gain;
	if (why === "sack") s.stats[1 - s.poss].sack += 1;
	s.clockRunning = why !== "oob";
	s.down += 1;
	const need = s.toGo;
	if (gain >= need - .15) {
		s.down = 1;
		s.toGo = Math.min(10, Math.max(.5, distGoal(s.poss, spot)));
		say(s, "FIRST DOWN", `${gain >= 0 ? "+" : ""}${gain.toFixed(0)} · ${spotName(spot)}`);
		sfx(s, "first");
		s.queue = {
			t: "spot",
			x: spot,
			first: true
		};
	} else if (s.down > 4) {
		say(s, "TURNOVER ON DOWNS", spotName(spot));
		sfx(s, "whistle");
		s.queue = {
			t: "ball",
			team: 1 - s.poss,
			x: spot
		};
	} else {
		s.toGo = Math.max(.5, need - gain);
		say(s, why === "sack" ? "SACK" : why === "oob" ? "OUT OF BOUNDS" : gain < -.4 ? "LOSS" : "TACKLED", `${gain >= 0 ? "+" : ""}${gain.toFixed(0)} · ${downText(s)}`);
		sfx(s, why === "sack" ? "hit" : "tackle");
		s.shake = why === "sack" ? .5 : .32;
		s.queue = {
			t: "spot",
			x: spot
		};
	}
	s.phase = "dead";
	s.deadT = 0;
}
function steerUser(p, pad, dir, dt, boost) {
	let ax = pad.ax;
	let ay = pad.ay;
	const mag = Math.hypot(ax, ay);
	if (mag > 1) {
		ax /= mag;
		ay /= mag;
	}
	const sp = p.spd * boost * (p.diving > 0 ? 1.25 : 1) * (p.juke > 0 ? 1.18 : 1);
	const tvx = dir * ay * sp;
	const tvy = dir * ax * sp;
	const accel = 42;
	p.vx += clamp(tvx - p.vx, -42 * dt, accel * dt);
	p.vy += clamp(tvy - p.vy, -42 * dt, accel * dt);
	if (mag < .08 && p.diving <= 0) {
		p.vx *= Math.max(0, 1 - 10 * dt);
		p.vy *= Math.max(0, 1 - 10 * dt);
	}
	p.x += p.vx * dt;
	p.y += p.vy * dt;
}
function follow(p, dt, speedScale = 1) {
	const wp = p.path[p.pi];
	if (!wp) {
		p.vx *= Math.max(0, 1 - 4 * dt);
		p.vy *= Math.max(0, 1 - 4 * dt);
		p.x += p.vx * dt;
		p.y += p.vy * dt;
		return;
	}
	const dx = wp.x - p.x;
	const dy = wp.y - p.y;
	const d = Math.hypot(dx, dy) || 1e-4;
	if (d < .55) {
		p.pi += 1;
		return;
	}
	const sp = p.spd * speedScale;
	p.vx = dx / d * sp;
	p.vy = dy / d * sp;
	p.x += p.vx * dt;
	p.y += p.vy * dt;
}
function seek(p, x, y, dt, scale) {
	const dx = x - p.x;
	const dy = y - p.y;
	const d = Math.hypot(dx, dy) || 1e-4;
	const sp = p.spd * scale;
	p.vx = dx / d * sp;
	p.vy = dy / d * sp;
	if (d < sp * dt) {
		p.x = x;
		p.y = y;
	} else {
		p.x += p.vx * dt;
		p.y += p.vy * dt;
	}
}
function nearest(s, p, pred) {
	let best;
	let bd = 1e9;
	for (const o of s.players) {
		if (o.id === p.id || !pred(o)) continue;
		const d = dist(p.x, p.y, o.x, o.y);
		if (d < bd) {
			bd = d;
			best = o;
		}
	}
	return best;
}
function moveAI(s, p, dt) {
	const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : void 0;
	const qb = P(s, s.poss, 0);
	const scale = p.shed > 0 ? 1.25 : 1;
	if (p.mode === "pursue" && carrier) {
		seek(p, carrier.x, carrier.y, dt, scale);
		return;
	}
	if (p.mode === "rush") {
		const shade = qb.y + (p.y - qb.y) * .25;
		seek(p, qb.x - s.dir * .4, shade, dt, (p.shed > 0 ? 1.3 : 1) * (s.sharp ? 1.05 : 1));
		return;
	}
	if (p.mode === "man" && p.man >= 0) {
		const rec = s.players[p.man];
		if (rec && !s.thrown) {
			const cushion = (defById(s.defId).press ? .45 : 1.7) * (s.sharp ? .85 : 1);
			seek(p, rec.x + s.dir * cushion, rec.y, dt, 1);
			return;
		}
	}
	if (p.mode === "spy" && !s.thrown) {
		seek(p, qb.x + s.dir * 3.5, qb.y, dt, .92);
		return;
	}
	if ((p.mode === "man" || p.mode === "zone" || p.mode === "spy") && s.thrown && s.ball.state === "air") {
		if (dist(p.x, p.y, s.ball.x, s.ball.y) < 22) {
			seek(p, s.ball.x, s.ball.y, dt, 1.05);
			return;
		}
	}
	if (p.mode === "zone" && !s.thrown) {
		seek(p, p.zx, p.zy, dt, dist(p.x, p.y, p.zx, p.zy) > 1.2 ? 1 : .35);
		return;
	}
	if (p.mode === "block") {
		const foe = nearest(s, p, (o) => o.team !== p.team && (o.mode === "rush" || o.mode === "pursue"));
		if (foe && dist(p.x, p.y, foe.x, foe.y) < 2.3) {
			seek(p, foe.x - s.dir * .35, foe.y + (p.y - foe.y) * .4, dt, .85);
			return;
		}
		follow(p, dt, .9);
		return;
	}
	if (carrier && p.id === carrier.id && p.team !== s.poss) {}
	if (carrier && p.id === carrier.id && !s.human[p.team]) {
		const threat = nearest(s, p, (o) => o.team !== p.team);
		let lat = 0;
		if (threat && dist(p.x, p.y, threat.x, threat.y) < 4 && Math.sign(s.dir * (threat.x - p.x)) > 0) lat = threat.y > p.y ? -1 : 1;
		const sp = p.spd;
		p.vx = s.dir * sp * .98;
		p.vy = lat * sp * .55;
		p.x += p.vx * dt;
		p.y += p.vy * dt;
		return;
	}
	follow(p, dt, p.mode === "route" ? 1 : .85);
}
function blocked(s, p) {
	if (p.shed > 0) return false;
	for (const o of s.players) {
		if (o.team === p.team || o.mode !== "block") continue;
		if (dist(p.x, p.y, o.x, o.y) < 1.45) return true;
	}
	return false;
}
function throwBall(s, targetIdx) {
	const qb = s.players[s.ball.carrier];
	if (!qb || qb.idx !== 0 || qb.team !== s.poss) return;
	if (s.thrown || s.ball.state !== "held") return;
	if (s.dir * (qb.x - s.los) > .4) return;
	const rec = P(s, s.poss, targetIdx);
	if (!rec || rec.ol) return;
	const pressure = s.players.filter((p) => p.team !== s.poss && !p.ol && dist(p.x, p.y, qb.x, qb.y) < 2.6 && !blocked(s, p)).length;
	let t = .45;
	let px = rec.x;
	let py = rec.y;
	for (let i = 0; i < 3; i++) {
		const pred = predict(rec, t, s.dir);
		px = pred.x;
		py = pred.y;
		t = clamp(Math.hypot(px - qb.x, py - qb.y) / 23, .38, 2.8);
	}
	const err = (rng(s) - .5) * (.4 + pressure * 1.7) * (s.sharp ? 1.15 : 1);
	const dx = px - qb.x;
	const dy = py - qb.y;
	const d = Math.hypot(dx, dy) || 1;
	px += -dy / d * err;
	py += dx / d * err;
	const T = clamp(Math.hypot(px - qb.x, py - qb.y) / 23, .38, 2.8);
	s.ball.state = "air";
	s.ball.carrier = -1;
	s.ball.x = qb.x;
	s.ball.y = qb.y;
	s.ball.z = 2.15;
	s.ball.vx = (px - qb.x) / T;
	s.ball.vy = (py - qb.y) / T;
	const g = 30;
	s.ball.vz = (-.7 + .5 * g * T * T) / T;
	s.ball.flight = 0;
	s.ball.hang = T;
	s.thrown = true;
	sfx(s, "pass");
}
function predict(p, t, dir) {
	if (!p.path.length || p.pi >= p.path.length) return {
		x: p.x + p.vx * t,
		y: p.y + p.vy * t
	};
	let x = p.x;
	let y = p.y;
	let left = t;
	let pi = p.pi;
	const path = p.path;
	while (left > 0 && pi < path.length) {
		const wp = path[pi];
		const d = Math.hypot(wp.x - x, wp.y - y);
		const step = p.spd * left;
		if (d < .05) {
			pi += 1;
			continue;
		}
		if (step >= d) {
			left -= d / p.spd;
			x = wp.x;
			y = wp.y;
			pi += 1;
		} else {
			x += (wp.x - x) / d * step;
			y += (wp.y - y) / d * step;
			left = 0;
		}
	}
	if (left > 0) x += dir * p.spd * left * .25;
	return {
		x,
		y
	};
}
function bestHot(s) {
	const play = offById(s.offId);
	let best = play.hot[0] ?? 2;
	let score = -999;
	for (const idx of play.hot) {
		const rec = P(s, s.poss, idx);
		if (!rec || rec.ol) continue;
		const pred = predict(rec, .6, s.dir);
		let sep = 30;
		for (const d of s.players) {
			if (d.team === s.poss) continue;
			sep = Math.min(sep, dist(pred.x, pred.y, d.x, d.y));
		}
		const depth = s.dir * (pred.x - s.los);
		const sc = sep + depth * .04;
		if (sc > score) {
			score = sc;
			best = idx;
		}
	}
	return best;
}
function catchBall(s) {
	if (s.ball.state !== "air") return;
	if (s.ball.flight < Math.min(.32, Math.max(.2, s.ball.hang * .38))) return;
	let best = -1;
	let bd = 1.72;
	for (const p of s.players) {
		if (p.ol && p.team === s.poss) continue;
		const d = dist(p.x, p.y, s.ball.x, s.ball.y);
		if (d < bd) {
			bd = d;
			best = p.id;
		}
	}
	if (best < 0) {
		if (s.ball.z <= .15) whistleIncomplete(s);
		return;
	}
	const me = s.players[best];
	const opp = nearest(s, me, (o) => o.team !== me.team && !o.ol);
	if (opp && dist(opp.x, opp.y, s.ball.x, s.ball.y) < 1.55 && opp) {
		if (rng(s) < .22) {
			whistleIncomplete(s);
			return;
		}
		const defCloser = dist(opp.x, opp.y, s.ball.x, s.ball.y) + .05 < bd;
		const offWins = rng(s) < (defCloser ? .42 : .66);
		secure(s, me.team === s.poss ? offWins ? me : opp : offWins ? opp : me);
		return;
	}
	if (s.ball.z <= 2.5) secure(s, me);
}
function secure(s, p) {
	s.ball.state = "held";
	s.ball.carrier = p.id;
	s.ball.z = 1.3;
	s.ball.vx = 0;
	s.ball.vy = 0;
	s.ctrl[p.team] = p.id;
	if (p.team === s.poss) {
		s.handed = true;
		say(s, "CAUGHT", p.name);
		sfx(s, "catch");
		for (const o of s.players) if (o.id === p.id) o.mode = "route";
		else if (o.team === s.poss) o.mode = "block";
		else o.mode = "pursue";
	} else {
		say(s, "PICKED", p.name);
		sfx(s, "int");
		s.shake = .4;
		for (const o of s.players) if (o.id === p.id) o.mode = "route";
		else if (o.team === p.team) o.mode = "block";
		else o.mode = "pursue";
	}
}
function tickLive(s, dt, pads) {
	s.liveT += dt;
	if (!s.freeze) {
		if ((s.q === 2 || s.q === 4) && s.clock > 120 && s.clock - dt * 4 <= 120) {
			s.clock = 120;
			s.freeze = true;
			s.clockRunning = false;
			say(s, "TWO-MINUTE WARNING", "");
			sfx(s, "whistle");
		} else if (s.clockRunning) s.clock = Math.max(0, s.clock - dt * 4);
	}
	s.shake = Math.max(0, s.shake - dt * 1.4);
	for (const team of [0, 1]) if (pads[team].switch && team !== s.poss && s.human[team]) cycleDef(s, team);
	const off = s.kind === "scrimmage" ? offById(s.offId) : void 0;
	if (off && off.group === "run" && !s.handed && s.liveT >= off.handoffAt && off.handoffAt < 20) {
		const rb = P(s, s.poss, 1);
		s.ball.carrier = rb.id;
		s.handed = true;
		s.ctrl[s.poss] = rb.id;
		sfx(s, "snap");
	}
	for (const p of s.players) {
		p.juke = Math.max(0, p.juke - dt);
		p.jukeCd = Math.max(0, p.jukeCd - dt);
		p.diving = Math.max(0, p.diving - dt);
		p.shed = Math.max(0, p.shed - dt);
		if (p.down) {
			p.vx = p.vy = 0;
			continue;
		}
		const human = s.human[p.team] && p.id === s.ctrl[p.team];
		const pad = pads[p.team];
		const steering = human && (Math.abs(pad.ax) + Math.abs(pad.ay) > .16 || p.diving > 0);
		if (human && pad.juke && p.jukeCd <= 0 && s.ball.carrier === p.id) {
			p.juke = .26;
			p.jukeCd = 1.2;
			p.vy += s.dir * (pad.ax === 0 ? rng(s) < .5 ? -1 : 1 : Math.sign(pad.ax)) * p.spd * .8;
			sfx(s, "juke");
		}
		if (human && pad.dive && s.ball.carrier === p.id && p.diving <= 0) {
			p.diving = .34;
			sfx(s, "hit");
		}
		if (steering) steerUser(p, pad, s.dir, dt, p.team === s.poss ? 1 : 1.04);
		else moveAI(s, p, dt);
		if (blocked(s, p) && (p.mode === "rush" || p.mode === "pursue")) {
			p.blockT = (p.blockT ?? 0) + dt;
			p.vx *= .82;
			p.vy *= .82;
			p.x += s.dir * 1.6 * dt;
			if ((p.blockT ?? 0) > (s.sharp ? 1.25 : 1.55)) {
				p.shed = .4;
				p.blockT = 0;
			}
		} else p.blockT = 0;
	}
	for (let i = 0; i < s.players.length; i++) for (let j = i + 1; j < s.players.length; j++) {
		const a = s.players[i];
		const b = s.players[j];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const d = Math.hypot(dx, dy) || 1e-4;
		if (d < .92) {
			const push = (.92 - d) * .5;
			a.x -= dx / d * push;
			a.y -= dy / d * push;
			b.x += dx / d * push;
			b.y += dy / d * push;
		}
	}
	for (const p of s.players) p.y = clamp(p.y, -28.5, 28.5);
	const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : void 0;
	if (s.ball.state === "held" && carrier) {
		s.ball.x = carrier.x + carrier.vx * .02;
		s.ball.y = carrier.y;
		s.ball.z = 1.25;
		if (carrier.team === 0 && carrier.x >= 110 || carrier.team === 1 && carrier.x <= 10) {
			scoreTD(s, carrier.team);
			return;
		}
		if (Math.abs(carrier.y) > 26.65) {
			carrier.y = Math.sign(carrier.y) * SIDELINE;
			whistleDown(s, "oob");
			return;
		}
		if (carrier.diving > 0 && carrier.diving < .04) {
			whistleDown(s, "dive");
			return;
		}
		let contact = 0;
		for (const d of s.players) {
			if (d.team === carrier.team || d.down) continue;
			if (blocked(s, d)) {
				d.grip = 0;
				continue;
			}
			if (dist(d.x, d.y, carrier.x, carrier.y) < 1.38) {
				contact += 1;
				d.grip += dt * (s.sharp && !s.human[carrier.team] ? 1.2 : 1);
				const need = contact >= 2 ? .12 : .26;
				if (d.grip > need && carrier.juke <= 0) {
					whistleDown(s, carrier.idx === 0 && carrier.team === s.poss && !s.handed ? "sack" : "tackle");
					return;
				}
				if (carrier.juke > 0 && d.grip > .05) {
					d.grip = 0;
					d.shed = Math.max(d.shed, .15);
				}
			} else d.grip = Math.max(0, d.grip - dt * .8);
		}
	} else if (s.ball.state === "air") {
		const g = 30;
		s.ball.flight += dt;
		s.ball.x += s.ball.vx * dt;
		s.ball.y += s.ball.vy * dt;
		s.ball.z += s.ball.vz * dt;
		s.ball.vz -= g * dt;
		if (Math.abs(s.ball.y) > 28.65) {
			whistleIncomplete(s);
			return;
		}
		catchBall(s);
		if (s.phase !== "live") return;
		if (s.ball.z <= 0 && s.ball.state === "air") whistleIncomplete(s);
	}
	if (s.phase !== "live") return;
	if (off && off.group === "pass" && !s.thrown && s.ball.state === "held") {
		const qb = P(s, s.poss, 0);
		if (s.ball.carrier === qb.id) {
			const pad = pads[s.poss];
			if (s.human[s.poss] && pad.throwTo !== null) throwBall(s, pad.throwTo);
			else if (!s.human[s.poss] && s.liveT >= off.throwAt) throwBall(s, bestHot(s));
			else if (s.human[s.poss] && s.liveT > 3.3 && Math.abs(pad.ax) + Math.abs(pad.ay) < .2) throwBall(s, bestHot(s));
		}
	}
	if (s.liveT > 9.5 && s.phase === "live") {
		if (s.ball.state === "air") whistleIncomplete(s);
		else whistleDown(s, "tackle");
	}
}
function cycleDef(s, team) {
	const order = [
		4,
		2,
		3,
		1,
		5,
		0,
		10,
		6,
		9
	].map((i) => P(s, team, i)).sort((a, b) => dist(a.x, a.y, s.ball.x, s.ball.y) - dist(b.x, b.y, s.ball.x, s.ball.y));
	const cur = s.ctrl[team];
	const at = Math.max(0, order.findIndex((p) => p.id === cur));
	s.ctrl[team] = order[(at + 1) % order.length].id;
}
function tickCall(s, dt) {
	s.playClock = Math.max(0, s.playClock - dt);
	s.shake = Math.max(0, s.shake - dt);
	if (s.playClock <= 0) {
		for (const team of [0, 1]) if (!s.chosen[team]) {
			if (team === s.poss) {
				s.los = clamp(s.los - s.dir * 5, 11, 109);
				say(s, "DELAY OF GAME", "5 yards");
				sfx(s, "whistle");
			}
			s.chosen[team] = cpuPick(s, team);
		}
		maybePresnap(s);
	}
}
function tickPresnap(s, dt, pads) {
	s.liveT += dt;
	const offenseHuman = s.human[s.poss];
	if (offenseHuman && pads[s.poss].snap || !offenseHuman && s.liveT > 1.15 || s.liveT > 7) {
		if (s.clockRunning && !s.freeze) s.clock = Math.max(0, s.clock - 16);
		s.freeze = false;
		s.clockRunning = true;
		s.phase = "live";
		s.liveT = 0;
		sfx(s, "snap");
		say(s, "", "");
	}
}
function tickDead(s, dt, pads) {
	s.deadT += dt;
	s.shake = Math.max(0, s.shake - dt * 1.2);
	const skip = pads[0].snap || pads[1].snap || pads[s.myTeam].snap;
	if (s.deadT > 1.55 || skip && s.deadT > .35) applyQueue(s);
}
function tickFg(s, dt) {
	if (!s.fg) return;
	s.fg.t += dt;
	if (!s.human[s.fg.team] && s.fg.t > .65) {
		const sweet = s.fg.dist < 30 ? .3 : s.fg.dist < 40 ? .2 : s.fg.dist < 50 ? .12 : .07;
		resolveKick(s, (rng(s) - .5) * sweet * (s.sharp ? 2.3 : 1.5));
	}
	if (s.fg && s.fg.t > 8 && s.human[s.fg.team]) resolveKick(s, 1);
}
function step(s, dt, pads) {
	if (s.paused || !s.simLocal) return;
	if (s.phase === "menu" || s.phase === "lobby" || s.phase === "final" || s.phase === "pat") return;
	if (s.phase === "call") return tickCall(s, dt);
	if (s.phase === "presnap") return tickPresnap(s, dt, pads);
	if (s.phase === "dead") return tickDead(s, dt, pads);
	if (s.phase === "fg") return tickFg(s, dt);
	if (s.phase === "live") tickLive(s, dt, pads);
}
function takeOverLocal(s) {
	s.online = false;
	s.simLocal = true;
	s.human = [s.myTeam === 0, s.myTeam === 1];
	if (s.phase === "lobby") beginSolo(s);
}
var qn = (n) => Math.round(n * 100) / 100;
function packSnap(s) {
	s.snapN += 1;
	return {
		k: "st",
		n: s.snapN,
		phase: s.phase,
		q: s.q,
		clock: qn(s.clock),
		pc: qn(s.playClock),
		down: s.down,
		toGo: qn(s.toGo),
		los: qn(s.los),
		dir: s.dir,
		poss: s.poss,
		score: [...s.score],
		banner: s.banner,
		sub: s.sub,
		ctrl: [...s.ctrl],
		px: s.players.map((p) => qn(p.x)),
		py: s.players.map((p) => qn(p.y)),
		pvx: s.players.map((p) => qn(p.vx)),
		pvy: s.players.map((p) => qn(p.vy)),
		ball: [
			qn(s.ball.x),
			qn(s.ball.y),
			qn(s.ball.z),
			s.ball.carrier,
			s.ball.state === "air" ? 1 : s.ball.state === "dead" ? 2 : 0,
			qn(s.ball.vx),
			qn(s.ball.vy),
			qn(s.ball.vz)
		],
		sfxN: s.sfxN,
		sfx: s.sfx,
		log: s.log.slice(0, 5),
		stats: s.stats,
		fg: s.fg,
		endNote: s.endNote,
		play: s.offId,
		def: s.defId,
		kind: s.kind,
		thrown: s.thrown,
		two: s.twoPt,
		paused: s.paused,
		chosen: [s.chosen[0], s.chosen[1]]
	};
}
function applySnap(s, snap) {
	if (snap.n < s.lastN) return;
	const teleport = !s.seen || snap.phase !== s.phase;
	s.lastN = snap.n;
	s.seen = true;
	s.phase = snap.phase;
	s.q = snap.q;
	s.clock = snap.clock;
	s.playClock = snap.pc;
	s.down = snap.down;
	s.toGo = snap.toGo;
	s.los = snap.los;
	s.dir = snap.dir;
	s.poss = snap.poss;
	s.score = snap.score;
	s.banner = snap.banner;
	s.sub = snap.sub;
	s.ctrl = snap.ctrl;
	s.sfxN = snap.sfxN;
	s.sfx = snap.sfx;
	s.log = snap.log;
	s.stats = snap.stats;
	s.fg = snap.fg;
	s.endNote = snap.endNote;
	s.offId = snap.play;
	s.defId = snap.def;
	s.kind = snap.kind;
	s.thrown = snap.thrown;
	s.twoPt = snap.two;
	s.paused = snap.paused;
	s.chosen = snap.chosen;
	s.ball.tx = snap.ball[0];
	s.ball.ty = snap.ball[1];
	s.ball.tz = snap.ball[2];
	s.ball.carrier = snap.ball[3];
	s.ball.state = snap.ball[4] === 1 ? "air" : snap.ball[4] === 2 ? "dead" : "held";
	s.ball.vx = snap.ball[5] ?? s.ball.vx;
	s.ball.vy = snap.ball[6] ?? s.ball.vy;
	s.ball.vz = snap.ball[7] ?? s.ball.vz;
	for (let i = 0; i < 22; i++) {
		const p = s.players[i];
		p.tx = snap.px[i] ?? p.x;
		p.ty = snap.py[i] ?? p.y;
		p.vx = snap.pvx[i] ?? 0;
		p.vy = snap.pvy[i] ?? 0;
		if (teleport) {
			p.x = p.tx;
			p.y = p.ty;
		}
	}
	if (teleport) {
		s.ball.x = s.ball.tx;
		s.ball.y = s.ball.ty;
		s.ball.z = s.ball.tz;
	}
}
function smoothGuest(s, dt) {
	const k = Math.min(1, dt * 10);
	for (const p of s.players) {
		const px = p.x + p.vx * dt;
		const py = p.y + p.vy * dt;
		p.x = px + (p.tx - px) * k;
		p.y = py + (p.ty - py) * k;
	}
	if (s.ball.state === "air") {
		s.ball.x += s.ball.vx * dt;
		s.ball.y += s.ball.vy * dt;
		s.ball.z = Math.max(0, s.ball.z + s.ball.vz * dt);
		s.ball.vz -= 30 * dt;
	}
	const bk = s.ball.state === "air" ? Math.min(1, dt * 6) : k;
	s.ball.x += (s.ball.tx - s.ball.x) * bk;
	s.ball.y += (s.ball.ty - s.ball.y) * bk;
	s.ball.z += (s.ball.tz - s.ball.z) * bk;
}
function openTarget(s) {
	return bestHot(s);
}
function clockLabel(sec) {
	const s = Math.max(0, Math.ceil(sec));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function readHud(s) {
	const fromLeft = s.los - 10;
	const firstX = s.los + s.dir * s.toGo;
	const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : void 0;
	const group = s.kind === "return" ? "return" : s.offId ? offById(s.offId).group : "run";
	return {
		phase: s.phase,
		q: s.q,
		clock: clockLabel(s.clock),
		pc: Math.ceil(s.playClock),
		down: downText(s),
		spot: spotName(s.los),
		score: [s.score[0], s.score[1]],
		poss: s.poss,
		banner: s.banner,
		sub: s.sub,
		log: s.log.slice(0, 4),
		fgDist: s.fg?.dist ?? 0,
		fgKind: s.fg?.kind ?? null,
		fgTeam: s.fg?.team ?? 0,
		endNote: s.endNote,
		myTeam: s.myTeam,
		offId: s.offId,
		defId: s.defId,
		thrown: s.thrown,
		two: s.twoPt,
		downN: s.down,
		toGo: s.toGo,
		losPct: Math.max(0, Math.min(100, fromLeft)),
		firstPct: Math.max(0, Math.min(100, firstX - 10)),
		carrierIsQb: !!carrier && carrier.idx === 0 && carrier.team === s.poss,
		group,
		online: s.online,
		ready: [s.chosen[0] != null, s.chosen[1] != null]
	};
}
var emptyEdges = () => ({
	snap: false,
	juke: false,
	dive: false,
	switch: false,
	throwTo: null
});
function Nightline() {
	const sim = (0, import_react.useRef)(createMatch());
	const canvasRef = (0, import_react.useRef)(null);
	const keys = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	const forced = (0, import_react.useRef)(null);
	const edges = (0, import_react.useRef)(emptyEdges());
	const touch = (0, import_react.useRef)({
		ax: 0,
		ay: 0
	});
	const remote = (0, import_react.useRef)(neutralPad());
	const net = (0, import_react.useRef)(null);
	const lastSfx = (0, import_react.useRef)(0);
	const phaseHold = (0, import_react.useRef)("menu");
	const flushNet = (0, import_react.useRef)(false);
	const [hud, setHud] = (0, import_react.useState)(() => readHud(sim.current));
	const [screen, setScreen] = (0, import_react.useState)("menu");
	const [sharp, setSharp] = (0, import_react.useState)(false);
	const [paused, setPaused] = (0, import_react.useState)(false);
	const [muted, setMute] = (0, import_react.useState)(false);
	const [picked, setPicked] = (0, import_react.useState)(null);
	const [booth, setBooth] = (0, import_react.useState)(null);
	const [linkLost, setLinkLost] = (0, import_react.useState)(false);
	const [linkNote, setLinkNote] = (0, import_react.useState)("");
	const [guestReady, setGuestReady] = (0, import_react.useState)(false);
	const [rematchAsk, setRematchAsk] = (0, import_react.useState)(false);
	const [asked, setAsked] = (0, import_react.useState)(false);
	const homeRef = (0, import_react.useRef)(false);
	const push = (0, import_react.useCallback)(() => setHud(readHud(sim.current)), []);
	const onPeer = (0, import_react.useCallback)((up) => {
		if (!up) setGuestReady(false);
	}, []);
	(0, import_react.useEffect)(() => {
		const onDown = (e) => {
			const el = e.target;
			if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
			keys.current.add(e.code);
			const s = sim.current;
			if ([
				"Space",
				"ArrowUp",
				"ArrowDown",
				"ArrowLeft",
				"ArrowRight"
			].includes(e.code)) e.preventDefault();
			if (e.code === "Escape") {
				if (s.phase !== "menu" && s.phase !== "lobby") {
					s.paused = !s.paused;
					setPaused(s.paused);
					flushNet.current = true;
					if (s.online && s.myTeam === 1) net.current?.send({
						k: "pause",
						on: s.paused
					});
				}
				return;
			}
			if (e.code === "Enter" || e.code === "Space" && (s.phase === "presnap" || s.phase === "dead")) edges.current.snap = true;
			else if (e.code === "Space") {
				if (s.phase === "live" && s.myTeam === s.poss && !s.thrown && s.kind === "scrimmage" && offById(s.offId).group === "pass" && s.ball.carrier === s.poss * 11) edges.current.throwTo = openTarget(s);
				else edges.current.juke = true;
			} else if (e.code === "KeyJ" || e.code === "ShiftLeft" || e.code === "ShiftRight") edges.current.juke = true;
			else if (e.code === "KeyF") edges.current.dive = true;
			else if (e.code === "KeyQ" || e.code === "KeyC") edges.current.switch = true;
			else if (e.code >= "Digit1" && e.code <= "Digit5" && s.phase === "live" && s.myTeam === s.poss) {
				const idx = offById(s.offId).hot[Number(e.code.slice(5)) - 1];
				if (idx !== void 0) edges.current.throwTo = idx;
			}
			if (e.code === "KeyM") {
				const next = !isMuted();
				setMuted(next);
				setMute(next);
			}
		};
		const onUp = (e) => keys.current.delete(e.code);
		const onBlur = () => keys.current.clear();
		window.addEventListener("keydown", onDown);
		window.addEventListener("keyup", onUp);
		window.addEventListener("blur", onBlur);
		const onVis = () => {
			if (document.visibilityState === "visible") resumeAudio();
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			window.removeEventListener("keydown", onDown);
			window.removeEventListener("keyup", onUp);
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const draw = createRenderer(canvas);
		let last = performance.now();
		let acc = 0;
		let hudAcc = 0;
		let sendAcc = 0;
		let raf = 0;
		const loop = (now) => {
			const dt = Math.min(.05, (now - last) / 1e3);
			last = now;
			acc += dt;
			hudAcc += dt;
			sendAcc += dt;
			const s = sim.current;
			let sentGuest = false;
			let first = true;
			let steps = 0;
			while (acc >= 1 / 60 && steps < 5) {
				const pad = readPad(keys.current, forced.current, touch.current, edges.current, first);
				const pads = [neutralPad(), neutralPad()];
				pads[s.myTeam] = pad;
				if (s.online && s.myTeam === 0) pads[1] = {
					ax: remote.current.ax,
					ay: remote.current.ay,
					snap: first && remote.current.snap,
					juke: first && remote.current.juke,
					dive: first && remote.current.dive,
					switch: first && remote.current.switch,
					throwTo: first ? remote.current.throwTo : null
				};
				if (s.simLocal) step(s, 1 / 60, pads);
				else if (first && !sentGuest) {
					const e = pad;
					if (net.current && (e.snap || e.juke || e.dive || e.switch || e.throwTo !== null)) net.current.send({
						k: "edge",
						snap: e.snap,
						juke: e.juke,
						dive: e.dive,
						switch: e.switch,
						throwTo: e.throwTo
					});
					sentGuest = true;
				}
				first = false;
				acc -= 1 / 60;
				steps += 1;
			}
			if (steps > 0 && s.online && s.myTeam === 0) {
				remote.current.snap = false;
				remote.current.juke = false;
				remote.current.dive = false;
				remote.current.switch = false;
				remote.current.throwTo = null;
			}
			if (!s.simLocal) smoothGuest(s, dt);
			setCrowdBed(s.phase === "live" ? .4 : s.phase === "menu" || s.phase === "lobby" ? .08 : .18);
			tickAudio(dt);
			if (s.simLocal && s.sfxN !== lastSfx.current) {
				lastSfx.current = s.sfxN;
				playSfx(s.sfx);
				flushNet.current = true;
			}
			if (s.online && s.simLocal && (flushNet.current || s.phase !== phaseHold.current)) {
				phaseHold.current = s.phase;
				flushNet.current = false;
				sendAcc = 1;
			}
			draw(s, dt, { team: s.myTeam });
			const link = net.current;
			if (s.online && link && s.phase !== "menu") {
				if (s.simLocal && sendAcc > (s.phase === "live" ? .05 : .12)) {
					link.broadcast(packSnap(s));
					sendAcc = 0;
				}
				if (!s.simLocal && sendAcc > .05) {
					const pad = readPad(keys.current, forced.current, touch.current, emptyEdges(), false);
					link.broadcast({
						k: "in",
						ax: pad.ax,
						ay: pad.ay
					});
					sendAcc = 0;
				}
			}
			if (hudAcc > .12) {
				hudAcc = 0;
				setHud(readHud(s));
			}
			raf = requestAnimationFrame(loop);
		};
		window.__controlsTest = {
			getYaw: () => {
				const s = sim.current;
				const p = s.players[s.ctrl[s.myTeam]];
				if (!p || s.phase !== "live") return 0;
				return viewYaw(s.dir, p.vx, p.vy);
			},
			getSpeed: () => {
				const s = sim.current;
				const p = s.players[s.ctrl[s.myTeam]];
				if (!p || s.phase !== "live") return 0;
				return Math.hypot(p.vx, p.vy);
			},
			setKeys: (codes) => {
				forced.current = codes.length ? new Set(codes) : null;
			}
		};
		raf = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(raf);
			delete window.__controlsTest;
		};
	}, []);
	function fireEdge(partial) {
		edges.current = {
			...edges.current,
			...partial
		};
	}
	function startSolo() {
		unlockAudio();
		beginSolo(sim.current, sharp);
		setScreen("play");
		setPaused(false);
		setLinkLost(false);
		push();
	}
	function call(id) {
		const s = sim.current;
		if (s.phase !== "call") return;
		setPicked(id);
		if (s.online && s.myTeam === 1) net.current?.send({
			k: "call",
			id
		});
		else {
			choosePlay(s, s.myTeam, id);
			flushNet.current = true;
		}
		push();
	}
	function onKickMeter(acc) {
		playSfx("kick");
		const s = sim.current;
		if (s.online && s.myTeam === 1) net.current?.send({
			k: "kick",
			acc
		});
		else {
			resolveKick(s, acc);
			flushNet.current = true;
		}
		push();
	}
	function quit() {
		const s = sim.current;
		s.phase = "menu";
		s.online = false;
		s.paused = false;
		s.simLocal = true;
		setBooth(null);
		setScreen("menu");
		setPaused(false);
		setLinkLost(false);
		setGuestReady(false);
		setRematchAsk(false);
		setAsked(false);
		setLinkNote("");
		push();
	}
	const onNet = (0, import_react.useCallback)((data) => {
		const msg = data;
		const s = sim.current;
		if (!homeRef.current && msg.k === "st") {
			const wasPaused = s.paused;
			const before = s.sfxN;
			applySnap(s, data);
			if (s.sfxN !== before) playSfx(s.sfx);
			if (s.paused !== wasPaused) setPaused(s.paused);
			return;
		}
		if (homeRef.current && msg.k === "in") {
			remote.current.ax = msg.ax ?? 0;
			remote.current.ay = msg.ay ?? 0;
		} else if (homeRef.current && msg.k === "edge") {
			remote.current.snap = !!msg.snap;
			remote.current.juke = !!msg.juke;
			remote.current.dive = !!msg.dive;
			remote.current.switch = !!msg.switch;
			remote.current.throwTo = msg.throwTo ?? null;
		} else if (homeRef.current && msg.k === "call" && msg.id) {
			choosePlay(s, 1, msg.id);
			flushNet.current = true;
		} else if (homeRef.current && msg.k === "kick" && typeof msg.acc === "number") {
			playSfx("kick");
			resolveKick(s, msg.acc);
			flushNet.current = true;
		} else if (homeRef.current && msg.k === "pat") {
			if (msg.mode === "two") {
				s.patTeam = 1;
				startTwo(s);
			} else startKick(s, 1, "xp");
			flushNet.current = true;
		} else if (homeRef.current && msg.k === "pause") {
			s.paused = !!msg.on;
			setPaused(s.paused);
			flushNet.current = true;
		} else if (homeRef.current && msg.k === "ready") setGuestReady(true);
		else if (homeRef.current && msg.k === "rematch") setRematchAsk(true);
	}, []);
	(0, import_react.useEffect)(() => {
		if (hud.phase !== "call") setPicked(null);
	}, [hud.phase]);
	(0, import_react.useEffect)(() => {
		return () => {
			net.current = null;
		};
	}, []);
	const offense = hud.poss === hud.myTeam;
	const showMeter = hud.phase === "fg" && hud.fgKind && hud.fgTeam === hud.myTeam;
	const targets = hud.phase === "live" && offense && !hud.thrown && hud.group === "pass" && hud.carrierIsQb ? offById(hud.offId).hot.slice(0, 5) : [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "relative h-dvh overflow-hidden bg-bg text-fg select-none",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
			ref: canvasRef,
			className: "absolute inset-0 h-full w-full touch-none"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "relative z-10 flex h-full flex-col",
			children: [
				hud.phase !== "menu" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scorebug, {
					hud,
					muted,
					onMute: () => {
						const next = !muted;
						setMuted(next);
						setMute(next);
					},
					onPause: () => {
						sim.current.paused = true;
						setPaused(true);
						flushNet.current = true;
						if (sim.current.online && sim.current.myTeam === 1) net.current?.send({
							k: "pause",
							on: true
						});
					}
				}),
				booth && hud.phase !== "menu" && hud.phase !== "lobby" && linkNote && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "pointer-events-none px-3 text-xs text-muted",
					children: linkNote
				}),
				hud.banner && hud.phase !== "menu" && hud.phase !== "call" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "pointer-events-none mx-auto mt-3 max-w-lg px-4 text-center",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-display text-4xl leading-none tracking-wide text-fg drop-shadow-sm",
						children: hud.banner
					}), hud.sub && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: hud.sub
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex-1" }),
				screen === "menu" && hud.phase === "menu" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, {
					sharp,
					onSharp: () => setSharp((v) => !v),
					onStart: startSolo,
					onLink: () => setScreen("link")
				}),
				screen === "link" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LinkPanel, {
					onBack: () => setScreen("menu"),
					onHost: () => {
						unlockAudio();
						const code = boothCode();
						homeRef.current = true;
						armOnline(sim.current, 0, true);
						setBooth({
							code,
							home: true
						});
						setScreen("booth");
						setLinkLost(false);
						setGuestReady(false);
						setRematchAsk(false);
						setAsked(false);
						push();
					},
					onJoin: (code) => {
						unlockAudio();
						homeRef.current = false;
						armOnline(sim.current, 1, false);
						setBooth({
							code,
							home: false
						});
						setScreen("booth");
						setLinkLost(false);
						setGuestReady(false);
						setRematchAsk(false);
						setAsked(false);
						push();
					}
				}),
				screen === "booth" && booth && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Online, {
					room: booth.code,
					home: booth.home,
					hud,
					netRef: net,
					onMessage: onNet,
					onKick: () => {
						hostKickoff(sim.current);
						flushNet.current = true;
						push();
					},
					onLost: () => setLinkLost(true),
					onLink: setLinkNote,
					guestReady,
					onPeer
				}),
				hud.phase === "call" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CallSheet, {
					offense,
					hud,
					picked,
					onPick: call
				}),
				hud.phase === "presnap" && offense && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto mb-4 flex w-full max-w-md flex-col items-center gap-2 px-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							offById(hud.offId).name,
							" · ",
							offById(hud.offId).formation
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-14 w-full rounded-xl bg-aces text-lg font-display tracking-wide text-bg",
						onClick: () => fireEdge({ snap: true }),
						children: "Snap"
					})]
				}),
				hud.phase === "presnap" && !offense && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto mb-4 w-full max-w-md px-4 text-center",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-display text-xl text-kings",
						children: defById(hud.defId).name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "They have the ball. You take one defender."
					})]
				}),
				hud.phase === "live" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LiveControls, {
					targets,
					poss: hud.poss,
					myTeam: hud.myTeam,
					onThrow: (idx) => fireEdge({ throwTo: idx }),
					onJuke: () => fireEdge({ juke: true }),
					onDive: () => fireEdge({ dive: true }),
					onSwitch: () => fireEdge({ switch: true }),
					onStick: (ax, ay) => {
						touch.current.ax = ax;
						touch.current.ay = ay;
					}
				}),
				hud.phase === "dead" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mx-auto mb-6 w-full max-w-md px-4",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-12 w-full rounded-xl border border-line bg-surface text-fg",
						onClick: () => fireEdge({ snap: true }),
						children: "Next"
					})
				}),
				hud.phase === "pat" && hud.myTeam === hud.poss && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto mb-6 grid w-full max-w-md grid-cols-2 gap-2 px-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-14 rounded-xl bg-aces font-display text-lg text-bg",
						onClick: () => {
							if (sim.current.online && sim.current.myTeam === 1) net.current?.send({
								k: "pat",
								mode: "xp"
							});
							else {
								startKick(sim.current, hud.myTeam, "xp");
								push();
							}
						},
						children: "Kick XP"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-14 rounded-xl border border-kings font-display text-lg text-kings",
						onClick: () => {
							if (sim.current.online && sim.current.myTeam === 1) net.current?.send({
								k: "pat",
								mode: "two"
							});
							else {
								startTwo(sim.current);
								push();
							}
						},
						children: "Go for 2"
					})]
				}),
				showMeter && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
					dist: hud.fgDist,
					label: hud.fgKind === "xp" ? "Extra point" : `${hud.fgDist} yards`,
					onKick: onKickMeter
				}),
				hud.phase === "fg" && !showMeter && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mb-8 text-center text-sm text-muted",
					children: "The kick is up…"
				}),
				hud.phase === "final" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Final, {
					hud,
					ask: rematchAsk,
					asked,
					onAgain: () => {
						if (sim.current.online && homeRef.current) {
							setRematchAsk(false);
							setAsked(false);
							hostKickoff(sim.current);
							flushNet.current = true;
							push();
						} else if (sim.current.online) {
							net.current?.send({ k: "rematch" });
							setAsked(true);
						} else startSolo();
					},
					onQuit: quit
				}),
				linkLost && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "absolute inset-x-0 bottom-0 z-20 mx-auto mb-6 w-full max-w-md px-4",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-xl border border-line bg-surface p-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-display text-xl",
								children: "Link dropped"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 text-sm text-muted",
								children: "Their booth closed. You can finish this one against the CPU."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mt-3 h-11 w-full rounded-lg bg-aces text-bg",
								onClick: () => {
									takeOverLocal(sim.current);
									setLinkLost(false);
									setScreen("play");
									push();
								},
								children: "Finish vs CPU"
							})
						]
					})
				}),
				paused && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "absolute inset-0 z-30 flex items-center justify-center bg-bg/80 px-4",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "w-full max-w-sm rounded-2xl border border-line bg-surface p-5",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-display text-3xl",
								children: "Paused"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 text-sm text-muted",
								children: hud.online ? "Held for both of you." : "Take a breath."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mt-4 flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-12 flex-1 rounded-xl bg-aces font-display text-lg text-bg",
									onClick: () => {
										sim.current.paused = false;
										setPaused(false);
										flushNet.current = true;
										if (sim.current.online && sim.current.myTeam === 1) net.current?.send({
											k: "pause",
											on: false
										});
									},
									children: "Resume"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-12 flex-1 rounded-xl border border-line",
									onClick: quit,
									children: "Quit"
								})]
							})
						]
					})
				})
			]
		})]
	});
}
function readPad(keys, forced, touch, edges, takeEdges) {
	const src = forced ?? keys;
	let ax = forced ? 0 : touch.ax;
	let ay = forced ? 0 : touch.ay;
	if (src.has("KeyA") || src.has("ArrowLeft")) ax -= 1;
	if (src.has("KeyD") || src.has("ArrowRight")) ax += 1;
	if (src.has("KeyW") || src.has("ArrowUp")) ay += 1;
	if (src.has("KeyS") || src.has("ArrowDown")) ay -= 1;
	const pad = {
		ax,
		ay,
		snap: takeEdges ? edges.snap : false,
		juke: takeEdges ? edges.juke : false,
		dive: takeEdges ? edges.dive : false,
		switch: takeEdges ? edges.switch : false,
		throwTo: takeEdges ? edges.throwTo : null
	};
	if (takeEdges) {
		edges.snap = false;
		edges.juke = false;
		edges.dive = false;
		edges.switch = false;
		edges.throwTo = null;
	}
	return pad;
}
function boothCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let out = "";
	for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * 32)];
	return out;
}
function Menu({ sharp, onSharp, onStart, onLink }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "absolute inset-0 flex items-end justify-center px-4 pb-8 sm:items-center",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-md rounded-2xl border border-line bg-bg/85 p-5 backdrop-blur-sm",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs tracking-widest text-aces",
					children: "NIGHT FOOTBALL"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
					className: "mt-1 font-display text-6xl leading-none text-fg",
					children: ["NIGHT", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-aces",
						children: "LINE"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: "Ridge Aces vs Vesper Kings. Call a play, then run it under the lights."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-5 flex flex-col gap-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "flex h-14 items-center justify-center gap-2 rounded-xl bg-aces font-display text-xl tracking-wide text-bg",
							onClick: onStart,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-5" }), "Start"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-fg",
							onClick: onLink,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link2, { className: "size-4" }), "Link a friend"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: `h-11 rounded-xl border text-sm ${sharp ? "border-kings text-kings" : "border-line text-muted"}`,
							onClick: onSharp,
							children: sharp ? "Sharp CPU on" : "Sharp CPU off"
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
					className: "mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "WASD move" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Space snap / throw / juke" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "1–5 choose a receiver" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Q switch defender" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "F dive for the sticks" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Esc pause" })
					]
				})
			]
		})
	});
}
function LinkPanel({ onBack, onHost, onJoin }) {
	const [code, setCode] = (0, import_react.useState)("");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "absolute inset-0 flex items-end justify-center px-4 pb-8 sm:items-center",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-md rounded-2xl border border-line bg-bg/90 p-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-3xl",
					children: "Two-player booth"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "A private code, then a direct link between your two browsers. For someone you mean to play — not a public lobby."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "mt-4 h-12 w-full rounded-xl bg-aces font-display text-lg text-bg",
					onClick: onHost,
					children: "Host the Aces"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "mt-3 flex gap-2",
					onSubmit: (e) => {
						e.preventDefault();
						const next = code.trim().toUpperCase();
						if (next.length >= 2) onJoin(next);
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: code,
						onChange: (e) => setCode(e.target.value.toUpperCase()),
						placeholder: "Code",
						maxLength: 8,
						className: "h-12 flex-1 rounded-xl border border-line bg-surface px-3 font-display text-xl tracking-widest text-fg outline-none"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "submit",
						className: "h-12 rounded-xl border border-kings px-4 text-kings",
						children: "Join"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "mt-3 h-10 text-sm text-muted",
					onClick: onBack,
					children: "Back"
				})
			]
		})
	});
}
function Online({ room, home, hud, netRef, onMessage, onKick, onLost, onLink, onPeer, guestReady }) {
	const p2p = useP2PRoom({
		room,
		name: home ? "Aces" : "Kings"
	});
	const seen = (0, import_react.useRef)(false);
	const [readySent, setReadySent] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		netRef.current = {
			broadcast: p2p.broadcast,
			send: p2p.send
		};
	}, [
		netRef,
		p2p.broadcast,
		p2p.send
	]);
	(0, import_react.useEffect)(() => p2p.onMessage((_from, data) => onMessage(data)), [p2p, onMessage]);
	(0, import_react.useEffect)(() => {
		const up = p2p.peers.some((p) => p.connectionState === "connected");
		if (up) seen.current = true;
		onPeer(up);
		if (seen.current && p2p.joined && !up && hud.phase !== "lobby" && hud.phase !== "menu") onLost();
		const peer = p2p.peers[0];
		if (!p2p.joined) onLink("Opening the booth…");
		else if (!peer) onLink("Waiting for the other coach");
		else if (peer.connectionState === "connected") onLink(peer.rttMs ? `Linked · ${peer.rttMs} ms` : "Linked");
		else if (peer.connectionState === "failed") onLink("Direct link failed");
		else onLink("Connecting…");
	}, [
		p2p.peers,
		p2p.joined,
		hud.phase,
		onLost,
		onLink,
		onPeer
	]);
	if (hud.phase !== "lobby") return null;
	const peer = p2p.peers[0];
	const linked = !!peer && peer.connectionState === "connected";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-md rounded-2xl border border-line bg-bg/90 p-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs tracking-widest text-muted",
					children: home ? "YOU ARE THE ACES" : "YOU ARE THE KINGS"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 font-display text-5xl tracking-widest text-fg",
					children: room
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "mt-2 inline-flex items-center gap-2 text-sm text-aces",
					onClick: () => void navigator.clipboard?.writeText(`Nightline booth ${room}`),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Copy, { className: "size-4" }), "Copy code"]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeerLine, {
					peer,
					joined: p2p.joined
				}),
				home ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: !linked || !guestReady,
					className: "mt-4 h-12 w-full rounded-xl bg-aces font-display text-lg text-bg disabled:opacity-40",
					onClick: onKick,
					children: guestReady ? "Kick off" : "Waiting for Kings"
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: !linked || readySent,
					className: "mt-4 h-12 w-full rounded-xl bg-kings font-display text-lg text-bg disabled:opacity-40",
					onClick: () => {
						netRef.current?.send({ k: "ready" });
						setReadySent(true);
					},
					children: readySent ? "Ready — waiting on the kick" : "Ready up"
				})
			]
		})
	});
}
function PeerLine({ peer, joined }) {
	if (!joined) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "mt-3 text-sm text-muted",
		children: "Opening the booth…"
	});
	if (!peer) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "mt-3 text-sm text-muted",
		children: "Waiting for the other coach."
	});
	if (peer.connectionState === "connected") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "mt-3 text-sm text-aces",
		children: ["Linked", peer.rttMs ? ` · ${peer.rttMs} ms` : ""]
	});
	if (peer.connectionState === "failed") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "mt-3 text-sm text-kings",
		children: "Can’t open a direct link. Try another network, then a new code."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "mt-3 text-sm text-muted",
		children: "Connecting…"
	});
}
function Scorebug({ hud, muted, onMute, onPause }) {
	const q = hud.q >= 5 ? "OT" : `Q${hud.q}`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-start justify-between gap-2 px-3 pt-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "min-w-0 flex-1",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-stretch overflow-hidden rounded-lg border border-line bg-surface/90",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "bg-aces px-2 py-1 font-display text-sm text-bg sm:px-3 sm:text-base",
						children: "ACES"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "px-2 font-display text-2xl leading-none tabular-nums sm:px-3 sm:text-3xl",
						children: hud.score[0]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "bg-kings px-2 py-1 font-display text-sm text-bg sm:px-3 sm:text-base",
						children: "KINGS"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "px-2 font-display text-2xl leading-none tabular-nums sm:px-3 sm:text-3xl",
						children: hud.score[1]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col justify-center px-2 text-xs text-muted",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display text-sm text-fg",
							children: q
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "tabular-nums",
							children: hud.clock
						})]
					})
				]
			}), hud.phase !== "lobby" && hud.phase !== "final" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-2 max-w-xs",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-baseline justify-between text-xs",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display text-sm text-fg",
							children: hud.down
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted",
							children: hud.spot
						}),
						hud.phase === "call" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: hud.pc <= 5 ? "text-kings" : "text-muted",
							children: [hud.pc, "s"]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute inset-y-0 left-0 w-1.5 bg-aces" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute inset-y-0 right-0 w-1.5 bg-kings" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "absolute top-0 h-full w-0.5 bg-bone",
							style: { left: `${hud.firstPct}%` }
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "absolute top-0 h-full w-1 bg-aces",
							style: { left: `${hud.losPct}%` }
						})
					]
				})]
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex gap-1",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-label": muted ? "Unmute" : "Mute",
				className: "flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg",
				onClick: onMute,
				children: muted ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VolumeX, { className: "size-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Volume2, { className: "size-4" })
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-label": "Pause",
				className: "flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg",
				onClick: onPause,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-4" })
			})]
		})]
	});
}
function CallSheet({ offense, hud, picked, onPick }) {
	const dist = hud.poss === 0 ? 100 - hud.losPct : hud.losPct;
	const suggested = offense ? suggestOff(hud.downN, hud.toGo, dist) : suggestDef(hud.downN, hud.toGo, dist);
	const plays = offense ? OFFENSE : DEFENSE;
	const theirs = hud.ready[hud.myTeam === 0 ? 1 : 0];
	const foe = hud.poss === 0 ? "the Aces" : "the Kings";
	const status = !hud.online ? offense ? "You have the ball" : `Stop ${foe}` : picked && !theirs ? "Call sent · waiting on them" : !picked && theirs ? offense ? "They're set · your call" : "They're set · pick a coverage" : offense ? "You have the ball" : `Stop ${foe}`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "call-sheet overflow-y-auto px-3 pb-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mx-auto mb-2 flex max-w-3xl items-center justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-display text-lg",
					children: offense ? "Offense" : "Defense"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs text-muted",
					children: status
				})]
			}),
			offense && hud.downN === 4 && !hud.two && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mx-auto mb-2 grid max-w-3xl grid-cols-2 gap-2",
				children: KICKS.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: `h-16 rounded-xl border px-3 text-left ${picked === k.id ? "border-aces bg-surface" : "border-line bg-surface/80"}`,
					onClick: () => onPick(k.id),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "block font-display text-lg",
						children: k.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-xs text-muted",
						children: k.blurb
					})]
				}, k.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mx-auto grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2",
				children: plays.map((p) => {
					const run = "group" in p && p.group === "run";
					const hot = p.id === suggested;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => onPick(p.id),
						className: `flex min-h-16 gap-3 rounded-xl border bg-surface/85 px-3 py-2 text-left ${picked === p.id ? "border-aces" : hot ? "border-bone" : "border-line"}`,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `mt-1 w-1 shrink-0 self-stretch rounded-full ${run ? "bg-aces" : "bg-kings"}` }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "flex items-center gap-2 font-display text-lg leading-none",
							children: [p.name, hot && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shield, { className: "size-3.5 text-bone" })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "mt-1 block text-xs text-muted",
							children: ["formation" in p ? `${p.formation} · ` : "", p.blurb]
						})] })]
					}, p.id);
				})
			})
		]
	});
}
function LiveControls({ targets, poss, myTeam, onThrow, onJuke, onDive, onSwitch, onStick }) {
	const names = [
		"X",
		"Z",
		"S",
		"Y",
		"H"
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-3 pb-4",
		children: [targets.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mx-auto mb-3 flex max-w-3xl justify-center gap-2",
			children: targets.map((idx, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "h-12 min-w-12 rounded-lg border border-aces bg-surface px-2 font-display text-aces",
				onClick: () => onThrow(idx),
				children: [
					i + 1,
					" ",
					names[i]
				]
			}, idx))
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto flex max-w-3xl items-end justify-between",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stick, { onChange: onStick }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [
					myTeam !== poss && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-14 rounded-xl border border-line bg-surface px-3 text-sm",
						onClick: onSwitch,
						children: "Switch"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-14 rounded-xl border border-line bg-surface px-3 text-sm",
						onClick: onDive,
						children: "Dive"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-14 rounded-xl bg-aces px-4 font-display text-lg text-bg",
						onClick: onJuke,
						children: "Juke"
					})
				]
			})]
		})]
	});
}
function Stick({ onChange }) {
	const ref = (0, import_react.useRef)(null);
	const ptr = (0, import_react.useRef)(null);
	const [knob, setKnob] = (0, import_react.useState)({
		x: 0,
		y: 0
	});
	function from(e) {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
		let y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
		const m = Math.hypot(x, y);
		if (m > 1) {
			x /= m;
			y /= m;
		}
		setKnob({
			x,
			y
		});
		onChange(x, y);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		ref,
		className: "relative h-28 w-28 touch-none rounded-full border border-line bg-surface/80",
		onPointerDown: (e) => {
			ptr.current = e.pointerId;
			e.currentTarget.setPointerCapture(e.pointerId);
			from(e);
		},
		onPointerMove: (e) => {
			if (ptr.current === e.pointerId) from(e);
		},
		onPointerUp: (e) => {
			if (ptr.current !== e.pointerId) return;
			ptr.current = null;
			setKnob({
				x: 0,
				y: 0
			});
			onChange(0, 0);
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "absolute top-1/2 left-1/2 size-11 rounded-full bg-aces",
			style: { transform: `translate(calc(-50% + ${knob.x * 32}px), calc(-50% - ${knob.y * 32}px))` }
		})
	});
}
function Meter({ dist, label, onKick }) {
	const sweet = dist < 30 ? .3 : dist < 40 ? .2 : dist < 50 ? .12 : .07;
	const [pos, setPos] = (0, import_react.useState)(.5);
	const posRef = (0, import_react.useRef)(.5);
	(0, import_react.useEffect)(() => {
		let raf = 0;
		const loop = (t) => {
			const phase = t / 850 % 2;
			const x = phase < 1 ? phase : 2 - phase;
			posRef.current = x;
			setPos(x);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto mb-5 w-full max-w-md px-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mb-2 text-center font-display text-xl",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "relative h-8 overflow-hidden rounded-full border border-line bg-surface",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "absolute inset-y-1 bg-aces/70",
					style: {
						left: `${50 - sweet * 50}%`,
						width: `${sweet * 100}%`
					}
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "absolute top-0 h-full w-1 bg-bone",
					style: { left: `${pos * 100}%` }
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "mt-3 h-14 w-full rounded-xl bg-aces font-display text-xl text-bg",
				onClick: () => onKick((posRef.current - .5) * 2),
				children: "Kick"
			})
		]
	});
}
function Final({ hud, ask, asked, onAgain, onQuit }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "absolute inset-0 z-20 flex items-center justify-center bg-bg/75 px-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-sm rounded-2xl border border-line bg-surface p-5 text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs tracking-widest text-muted",
					children: "FINAL"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-1 font-display text-5xl",
					children: [
						hud.score[0],
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted",
							children: "–"
						}),
						hud.score[1]
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-aces",
					children: hud.endNote
				}),
				ask && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-kings",
					children: "They want another kickoff."
				}),
				asked && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: "Rematch sent. Waiting on the host."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4 grid grid-cols-2 gap-2 text-left text-xs text-muted",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Aces on the board" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-right",
						children: "Kings on the board"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4 flex gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-12 flex-1 rounded-xl bg-aces font-display text-bg",
						onClick: onAgain,
						disabled: asked,
						children: ask ? "Kick it off" : asked ? "Asked" : "Rematch"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "h-12 flex-1 rounded-xl border border-line",
						onClick: onQuit,
						children: "Menu"
					})]
				})
			]
		})
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Nightline, {});
}
//#endregion
export { Home as component };
