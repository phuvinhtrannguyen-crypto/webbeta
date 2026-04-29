import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';

// Simple mesh-WebRTC voice chat across all players in the room.
// Each peer creates an offer to every other peer based on socket ids (deterministic initiator).
// When enabled=false, local mic track is stopped and we announce ourselves silent.
export function useVoiceChat(players, myId) {
  const [enabled, setEnabled] = useState(false);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const audioElsRef = useRef(new Map());
  const speakingTimersRef = useRef(new Map());

  // Initiator rule: the peer with the lexicographically SMALLER id creates the offer.
  const shouldInitiateTo = (otherId) => myId && otherId && myId < otherId;

  const closePeer = (peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      peersRef.current.delete(peerId);
    }
    const el = audioElsRef.current.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      audioElsRef.current.delete(peerId);
    }
  };

  const createPeer = async (peerId) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peersRef.current.set(peerId, pc);

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit('webrtc_signal', { to: peerId, data: { candidate: ev.candidate } });
      }
    };

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      let el = audioElsRef.current.get(peerId);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.playsInline = true;
        document.body.appendChild(el);
        audioElsRef.current.set(peerId, el);
      }
      el.srcObject = stream;
      attachSpeakingDetection(peerId, stream);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        closePeer(peerId);
      }
    };

    if (shouldInitiateTo(peerId)) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_signal', { to: peerId, data: { sdp: pc.localDescription } });
    }
    return pc;
  };

  const attachSpeakingDetection = (peerId, stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let active = false;
      const tick = () => {
        if (!peersRef.current.has(peerId)) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        const avg = sum / data.length;
        const isActive = avg > 12;
        if (isActive !== active) {
          active = isActive;
          socket.emit('speaking', { speaking: isActive });
        }
        speakingTimersRef.current.set(peerId, requestAnimationFrame(tick));
      };
      tick();
    } catch {
      // ignore
    }
  };

  // Start / stop local mic based on `enabled`.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (enabled) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          // Add tracks to existing peers
          for (const pc of peersRef.current.values()) {
            for (const track of stream.getTracks()) {
              // avoid double-adding
              if (!pc.getSenders().find((s) => s.track === track)) {
                pc.addTrack(track, stream);
              }
            }
          }
          // Local speaking detection
          attachSpeakingDetection('__me__', stream);
          socket.emit('webrtc_hello');
        } catch (e) {
          console.warn('Mic denied', e);
          setEnabled(false);
        }
      } else {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
        }
        socket.emit('speaking', { speaking: false });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Whenever the set of players changes, open connections to each (except self).
  useEffect(() => {
    if (!myId) return;
    const otherIds = new Set(players.map((p) => p.id).filter((id) => id !== myId));
    // Close peers that are no longer in room.
    for (const peerId of [...peersRef.current.keys()]) {
      if (!otherIds.has(peerId)) closePeer(peerId);
    }
    // Open new peers (only initiator side).
    for (const peerId of otherIds) {
      if (shouldInitiateTo(peerId) && !peersRef.current.has(peerId)) {
        createPeer(peerId);
      }
    }
  }, [players, myId]);

  // Socket signaling handlers.
  useEffect(() => {
    const onHello = async ({ from }) => {
      if (shouldInitiateTo(from)) {
        const pc = await createPeer(from);
        if (pc.signalingState === 'stable' && pc.localDescription == null) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_signal', { to: from, data: { sdp: pc.localDescription } });
        }
      }
    };
    const onSignal = async ({ from, data }) => {
      let pc = peersRef.current.get(from);
      if (!pc) pc = await createPeer(from);
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc_signal', { to: from, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (e) {
            console.warn('ICE error', e);
          }
        }
      } catch (e) {
        console.warn('Signal error', e);
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
