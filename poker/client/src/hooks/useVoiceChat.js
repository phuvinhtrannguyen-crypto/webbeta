import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import {
  ensureContext,
  registerPeerAudioEl,
  unregisterPeerAudioEl,
} from '../audio/engine.js';

// Mesh-WebRTC voice chat. Each peer pair has a single RTCPeerConnection.
//
// Flow when mic is toggled on:
//   1. getUserMedia → localStreamRef
//   2. Add tracks to every existing peer connection.
//   3. negotiationneeded fires → we (the polite/initiator side) generate a
//      fresh offer that includes the audio mline; remote peer answers.
// Without renegotiation a connection that opened *before* the mic was on has
// no audio mline, so even after addTrack the remote never hears anything.
//
// Initiator rule (deterministic): the peer with the lexicographically smaller
// socket id is the initiator (createOffer). This avoids glare.
export function useVoiceChat(players, myId) {
  const [enabled, setEnabled] = useState(false);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const audioElsRef = useRef(new Map());
  const speakingTimersRef = useRef(new Map());
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  const shouldInitiateTo = (otherId) =>
    myIdRef.current && otherId && myIdRef.current < otherId;

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
      unregisterPeerAudioEl(peerId);
    }
    const raf = speakingTimersRef.current.get(peerId);
    if (raf) cancelAnimationFrame(raf);
    speakingTimersRef.current.delete(peerId);
  };

  const renegotiate = async (peerId) => {
    const pc = peersRef.current.get(peerId);
    if (!pc) return;
    if (!shouldInitiateTo(peerId)) return; // only initiator pushes offers
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_signal', {
        to: peerId,
        data: { sdp: pc.localDescription },
      });
    } catch (e) {
      console.warn('[voice] renegotiate error', e);
    }
  };

  const createPeer = (peerId) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peersRef.current.set(peerId, pc);

    // Always allocate a transceiver for audio so the SDP has an audio mline
    // even before getUserMedia returns. This avoids "no media" answers.
    try {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    } catch {}

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          pc.addTrack(track, localStreamRef.current);
        } catch (e) {
          console.warn('[voice] addTrack', e);
        }
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit('webrtc_signal', {
          to: peerId,
          data: { candidate: ev.candidate },
        });
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      let el = audioElsRef.current.get(peerId);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.playsInline = true;
        // Note: we DO NOT mute by default — the audio engine controls volume.
        document.body.appendChild(el);
        audioElsRef.current.set(peerId, el);
        registerPeerAudioEl(peerId, el);
      }
      el.srcObject = stream;
      const tryPlay = () => {
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
      };
      tryPlay();
      attachSpeakingDetection(peerId, stream);
    };

    pc.onnegotiationneeded = async () => {
      // Only the initiator side should push offers (avoid glare).
      if (!shouldInitiateTo(peerId)) return;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_signal', {
          to: peerId,
          data: { sdp: pc.localDescription },
        });
      } catch (e) {
        console.warn('[voice] negotiationneeded', e);
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        closePeer(peerId);
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
      // NOTE: do NOT connect analyser to destination — that would cause
      // local feedback for our own mic stream. The remote peer's <audio>
      // element handles the actual playback.
      const data = new Uint8Array(analyser.frequencyBinCount);
      let active = false;
      const isLocal = peerId === '__me__';
      const tick = () => {
        if (isLocal) {
          if (!localStreamRef.current) return;
        } else if (!peersRef.current.has(peerId)) {
          return;
        }
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        const avg = sum / data.length;
        const isActive = avg > 12;
        if (isActive !== active) {
          active = isActive;
          if (isLocal) socket.emit('speaking', { speaking: isActive });
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
          ensureContext(); // unlock audio for SFX/playback
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          // Add tracks to every existing peer; negotiationneeded will refire.
          for (const [peerId, pc] of peersRef.current) {
            for (const track of stream.getTracks()) {
              const exists = pc.getSenders().find((s) => s.track === track);
              if (!exists) {
                // Prefer replaceTrack onto the pre-allocated audio sender
                // so we don't add a second mline.
                const audioSender = pc.getSenders().find(
                  (s) => s.track && s.track.kind === 'audio',
                ) || pc.getSenders().find((s) => !s.track);
                if (audioSender && !audioSender.track) {
                  try {
                    await audioSender.replaceTrack(track);
                  } catch {
                    pc.addTrack(track, stream);
                  }
                } else {
                  pc.addTrack(track, stream);
                }
              }
            }
            // Force a fresh offer so the answer side picks up the new track.
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
          // Replace senders with null so the remote stops receiving audio.
          for (const [peerId, pc] of peersRef.current) {
            for (const sender of pc.getSenders()) {
              if (sender.track && sender.track.kind === 'audio') {
                try {
                  await sender.replaceTrack(null);
                } catch {}
              }
            }
            renegotiate(peerId);
          }
        }
        socket.emit('speaking', { speaking: false });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Open / close peer connections as the room roster changes.
  useEffect(() => {
    if (!myId) return;
    const otherIds = new Set(
      players.map((p) => p.id).filter((id) => id !== myId && id),
    );
    for (const peerId of [...peersRef.current.keys()]) {
      if (!otherIds.has(peerId)) closePeer(peerId);
    }
    for (const peerId of otherIds) {
      if (shouldInitiateTo(peerId) && !peersRef.current.has(peerId)) {
        const pc = createPeer(peerId);
        // Initiator pushes a fresh offer (negotiationneeded will fire after
        // the audio transceiver is added in createPeer).
        // We also explicitly trigger one here in case the synchronous
        // addTransceiver doesn't fire negotiationneeded on every browser.
        renegotiate(peerId);
        // Touch pc so eslint doesn't complain (unused-var) — pc is real.
        if (!pc) {
          /* unreachable */
        }
      }
    }
  }, [players, myId]);

  // Socket signaling handlers.
  useEffect(() => {
    const onHello = ({ from }) => {
      if (shouldInitiateTo(from)) {
        // Make sure a peer exists; renegotiate kicks off the offer.
        if (!peersRef.current.has(from)) createPeer(from);
        renegotiate(from);
      }
    };
    const onSignal = async ({ from, data }) => {
      let pc = peersRef.current.get(from);
      if (!pc) pc = createPeer(from);
      try {
        if (data.sdp) {
          const desc = data.sdp;
          await pc.setRemoteDescription(desc);
          if (desc.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc_signal', {
              to: from,
              data: { sdp: pc.localDescription },
            });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (e) {
            console.warn('[voice] addIceCandidate', e);
          }
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    return () => {
      for (const id of [...peersRef.current.keys()]) closePeer(id);
      if (localStreamRef.current)
        localStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { enabled, setEnabled };
}
