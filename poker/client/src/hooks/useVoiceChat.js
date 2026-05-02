import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import {
  ensureContext,
  registerPeerAudioEl,
  unregisterPeerAudioEl,
} from '../audio/engine.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

function unlockRemoteAudio() {
  try {
    ensureContext();
  } catch {}
  document.querySelectorAll('audio[data-peer-audio="1"]').forEach((el) => {
    try {
      el.muted = false;
      el.volume = el.volume || 1;
      el.play().catch(() => {});
    } catch {}
  });
}

if (typeof window !== 'undefined') {
  ['click', 'touchstart', 'pointerdown', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, unlockRemoteAudio, { passive: true, capture: true });
  });
}

export function useVoiceChat(players, myId) {
  const [enabled, setEnabled] = useState(false);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioElsRef = useRef(new Map());
  const speakingTimersRef = useRef(new Map());
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  const shouldInitiateTo = (otherId) => myIdRef.current && otherId && myIdRef.current < otherId;

  const closePeer = (peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      try { pc.close(); } catch {}
      peersRef.current.delete(peerId);
    }
    const el = audioElsRef.current.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      audioElsRef.current.delete(peerId);
      unregisterPeerAudioEl(peerId);
    }
    const raf = speakingTimersRef.current.get(peerId);
    if (raf) cancelAnimationFrame(raf);
    speakingTimersRef.current.delete(peerId);
  };

  const attachRemoteAudio = (peerId, stream) => {
    let el = audioElsRef.current.get(peerId);
    if (!el) {
      el = document.createElement('audio');
      el.dataset.peerAudio = '1';
      el.autoplay = true;
      el.playsInline = true;
      el.muted = false;
      el.volume = 1;
      el.style.position = 'fixed';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      audioElsRef.current.set(peerId, el);
      registerPeerAudioEl(peerId, el);
    }
    if (el.srcObject !== stream) el.srcObject = stream;
    const tryPlay = () => {
      el.muted = false;
      const p = el.play();
      if (p?.catch) p.catch(() => {});
    };
    tryPlay();
    setTimeout(tryPlay, 250);
    setTimeout(tryPlay, 1000);
  };

  const addLocalTrackToPeer = async (pc, stream) => {
    const track = stream?.getAudioTracks?.()[0];
    if (!track) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio') || pc.getSenders().find((s) => !s.track);
    if (sender) {
      try {
        await sender.replaceTrack(track);
        return;
      } catch {}
    }
    try { pc.addTrack(track, stream); } catch {}
  };

  const renegotiate = async (peerId) => {
    const pc = peersRef.current.get(peerId);
    if (!pc || !shouldInitiateTo(peerId) || pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_signal', { to: peerId, data: { sdp: pc.localDescription } });
    } catch (e) {
      console.warn('[voice] renegotiate error', e);
    }
  };

  const createPeer = (peerId) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, pc);

    try {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    } catch {}

    if (localStreamRef.current) addLocalTrackToPeer(pc, localStreamRef.current);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit('webrtc_signal', { to: peerId, data: { candidate: ev.candidate } });
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] || new MediaStream([ev.track]);
      attachRemoteAudio(peerId, stream);
      attachSpeakingDetection(peerId, stream);
    };

    pc.onnegotiationneeded = () => renegotiate(peerId);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) closePeer(peerId);
      if (pc.connectionState === 'connected') unlockRemoteAudio();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') unlockRemoteAudio();
      if (pc.iceConnectionState === 'failed') {
        try { pc.restartIce(); } catch {}
        renegotiate(peerId);
      }
    };

    return pc;
  };

  const attachSpeakingDetection = (peerId, stream) => {
    try {
      const ctx = ensureContext();
      if (!ctx) return;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let active = false;
      const isLocal = peerId === '__me__';
      const tick = () => {
        if (isLocal) {
          if (!localStreamRef.current) return;
        } else if (!peersRef.current.has(peerId)) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        const isActive = sum / data.length > 10;
        if (isActive !== active) {
          active = isActive;
          if (isLocal) socket.emit('speaking', { speaking: isActive });
        }
        speakingTimersRef.current.set(peerId, requestAnimationFrame(tick));
      };
      tick();
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (enabled) {
        try {
          unlockRemoteAudio();
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          for (const [peerId, pc] of peersRef.current) {
            await addLocalTrackToPeer(pc, stream);
            renegotiate(peerId);
          }
          attachSpeakingDetection('__me__', stream);
          socket.emit('webrtc_hello');
        } catch (e) {
          console.warn('[voice] mic denied', e);
          setEnabled(false);
        }
      } else {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
          for (const [peerId, pc] of peersRef.current) {
            for (const sender of pc.getSenders()) {
              if (sender.track?.kind === 'audio') {
                try { await sender.replaceTrack(null); } catch {}
              }
            }
            renegotiate(peerId);
          }
        }
        socket.emit('speaking', { speaking: false });
      }
    }
    run();
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!myId) return;
    const otherIds = new Set(players.map((p) => p.id).filter((id) => id !== myId && id));
    for (const peerId of [...peersRef.current.keys()]) {
      if (!otherIds.has(peerId)) closePeer(peerId);
    }
    for (const peerId of otherIds) {
      if (!peersRef.current.has(peerId)) createPeer(peerId);
      if (shouldInitiateTo(peerId)) setTimeout(() => renegotiate(peerId), 120);
    }
    socket.emit('webrtc_hello');
  }, [players, myId]);

  useEffect(() => {
    const onHello = ({ from }) => {
      if (!from || from === myIdRef.current) return;
      if (!peersRef.current.has(from)) createPeer(from);
      if (shouldInitiateTo(from)) setTimeout(() => renegotiate(from), 80);
      unlockRemoteAudio();
    };
    const onSignal = async ({ from, data }) => {
      if (!from || from === myIdRef.current) return;
      let pc = peersRef.current.get(from);
      if (!pc) pc = createPeer(from);
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            if (localStreamRef.current) await addLocalTrackToPeer(pc, localStreamRef.current);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc_signal', { to: from, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          try { await pc.addIceCandidate(data.candidate); } catch (e) { console.warn('[voice] addIceCandidate', e); }
        }
        unlockRemoteAudio();
      } catch (e) {
        console.warn('[voice] signal', e);
      }
    };
    socket.on('webrtc_hello', onHello);
    socket.on('webrtc_signal', onSignal);
    return () => {
      socket.off('webrtc_hello', onHello);
      socket.off('webrtc_signal', onSignal);
    };
  }, [myId]);

  useEffect(() => {
    return () => {
      for (const id of [...peersRef.current.keys()]) closePeer(id);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { enabled, setEnabled };
}
