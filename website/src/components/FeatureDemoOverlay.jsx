"use client";

import { useEffect, useMemo, useRef, useState } from 'react'
import { DEMOS } from '../constants'

function FeatureDemoOverlay({ isOpen, onClose, initialFeature, overlayId = 'feature-demo-overlay' }) {
  const sections = useMemo(() => groupByFeature(DEMOS), [])
  const features = useMemo(() => sections.map(s => s.feature), [sections])
  const slides = useMemo(() => sections.map(s => s.items?.[0]).filter(Boolean).slice(0, 3), [sections])
  const n = slides.length

  // Track position without wrap (0..n-1)
  const [pos, setPos] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const overlayRef = useRef(null)
  const closeBtnRef = useRef(null)
  const [rendered, setRendered] = useState(isOpen)
  const [visible, setVisible] = useState(false)
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  const [captionVisible, setCaptionVisible] = useState(true)
  const hideTimerRef = useRef(null)

  // Mount/unmount with fade animation
  useEffect(() => {
    if (isOpen) {
      setRendered(true)
      // double RAF to ensure first paint at opacity 0 before animating
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      document.body.style.overflow = 'hidden'
      return () => cancelAnimationFrame(id)
    } else {
      setVisible(false)
      document.body.style.overflow = 'unset'
    }
    return () => { document.body.style.overflow = 'unset' }
  }, [isOpen])

  // Focus the close button when the overlay is visible
  useEffect(() => {
    if (visible) {
      try { closeBtnRef.current?.focus() } catch { /* noop */ }
    }
  }, [visible])

  // After fade-out completes, unmount
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onEnd = (e) => {
      if (e.propertyName !== 'opacity') return
      if (!visible) setRendered(false)
    }
    el.addEventListener('transitionend', onEnd)
    return () => el.removeEventListener('transitionend', onEnd)
  }, [visible])

  // Track viewport for mobile layout
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Trap focus within the overlay when open
  useEffect(() => {
    const el = overlayRef.current
    if (!el || !isOpen) return
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const focusables = el.querySelectorAll(
        'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !el.contains(active)) { e.preventDefault(); last.focus() }
      } else {
        if (active === last) { e.preventDefault(); first.focus() }
      }
    }
    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (!isOpen) return
      if (e.key === 'Escape') onClose?.()
      if (e.key === 'ArrowRight') setPos((p) => Math.min(n - 1, p + 1))
      if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose, n])

  // Sync initial feature
  useEffect(() => {
    if (!initialFeature) return
    const i = Math.max(0, features.findIndex(f => f === initialFeature))
    setPos(Math.min(n - 1, i) || 0)
    setIsPlaying(false)
  }, [initialFeature, features, n])
  
  // Reset playing when slide changes
  useEffect(() => { setIsPlaying(false) }, [pos])

  // Caption visibility rules
  useEffect(() => {
    // clear any existing timer
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
    if (isPlaying) {
      setCaptionVisible(true)
      hideTimerRef.current = setTimeout(() => setCaptionVisible(false), 2000)
    } else {
      setCaptionVisible(true)
    }
    return () => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null } }
  }, [isPlaying])

  // Show caption on user activity during playback, then hide after a short delay
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onActivity = () => {
      if (!isPlaying) return
      setCaptionVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => setCaptionVisible(false), 1600)
    }
    el.addEventListener('mousemove', onActivity)
    el.addEventListener('click', onActivity)
    el.addEventListener('touchstart', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      el.removeEventListener('mousemove', onActivity)
      el.removeEventListener('click', onActivity)
      el.removeEventListener('touchstart', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [isPlaying])

  if (!rendered || !n) return null

  const demo = slides[pos]
  const isMobile = vw <= 768

  const overlayClass = `demo-overlay${visible ? ' is-visible' : ''}`
  const stageClass = `demo-stage${visible ? ' is-visible' : ''}`

  return (
    <div
      id={overlayId}
      ref={overlayRef}
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-demo-title"
    >
      <button className="demo-backdrop" aria-label="Close dialog" tabIndex="-1" onClick={onClose} />
      <h2 id="feature-demo-title" className="sr-only">Feature demo</h2>
      <button ref={closeBtnRef} className="demo-close" aria-label="Close" onClick={onClose}>✕</button>

      {n > 1 && pos > 0 && (
        <button
          className="demo-nav-left"
          aria-label="Previous"
          onClick={(e) => { e.stopPropagation(); setIsPlaying(false); setPos(p => Math.max(0, p - 1)) }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon-shadow"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
      )}

      <div className={stageClass}>
        <div className="demo-track" style={{ '--track-x': `-${pos * 100}%` }}>
          {slides.map((s) => renderSlide(s))}
        </div>

        <div className="demo-edge-left" aria-hidden="true" />
        <div className="demo-edge-right" aria-hidden="true" />

        {!isMobile && (
          <div className={`demo-caption-layer${captionVisible ? ' is-shown' : ''}`}>
            <div className="demo-caption-row">
              <div className="demo-caption-text">
                <div className="demo-caption-title">{demo.title}</div>
                <div className="demo-caption-desc">{demo.description}</div>
              </div>
            </div>
          </div>
        )}

        {!isPlaying && (
          <button
            className="demo-play-btn"
            aria-label={`Play ${demo.title}`}
            onClick={() => setIsPlaying(true)}
          >
            ▶
          </button>
        )}

        {isPlaying && (
          <iframe
            key={demo.youtubeId}
            src={`https://www.youtube-nocookie.com/embed/${demo.youtubeId}?autoplay=1&rel=0&modestbranding=1`}
            title={demo.title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="demo-iframe-overlay"
          />
        )}
      </div>

      {isMobile && (
        <div className="demo-caption-below">
          <div className="demo-caption-title-mobile">{demo.title}</div>
          <div className="demo-caption-desc-mobile">{demo.description}</div>
        </div>
      )}

      {/* Thumbnail selector */}
      <div className="demo-thumbbar" role="tablist" aria-label="Demo slides">
        {slides.map((s, i) => {
          const thumb = s.thumbnail || `https://i.ytimg.com/vi/${s.youtubeId}/mqdefault.jpg`
          const active = i === pos
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              aria-label={`View ${s.title}`}
              className={`demo-thumbbtn${active ? ' is-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setIsPlaying(false); setPos(i) }}
            >
              <img src={thumb} alt="" className="demo-thumbimg" loading="lazy" />
            </button>
          )
        })}
      </div>

      {n > 1 && pos < n - 1 && (
        <button
          className="demo-nav-right"
          aria-label="Next"
          onClick={(e) => { e.stopPropagation(); setIsPlaying(false); setPos(p => Math.min(n - 1, p + 1)) }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon-shadow"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      )}
    </div>
  )
}

function groupByFeature(items) {
  const map = new Map()
  for (const d of items) {
    const key = d.feature || 'Other'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(d)
  }
  return [...map.entries()].map(([feature, arr]) => ({ feature, items: arr }))
}

// styles moved to CSS classes in index.css to keep code DRY

export default FeatureDemoOverlay

function renderSlide(s) {
  if (!s) return null
  const thumb = s.thumbnail || `https://i.ytimg.com/vi_webp/${s.youtubeId}/maxresdefault.webp`
  const fallback = `https://i.ytimg.com/vi/${s.youtubeId}/maxresdefault.jpg`
  // We cannot access setIsPlaying here, so we render only the passive view; active slide controls playback in parent
  return (
    <div key={s.id} className="demo-slide-item">
      <div className="demo-thumb-wrap">
        <img
          src={thumb}
          alt={s.title}
          loading="lazy"
          decoding="async"
          className="demo-thumb-img"
          onError={(e) => { e.currentTarget.src = fallback }}
        />
      </div>
    </div>
  )
}
