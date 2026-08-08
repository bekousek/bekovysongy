/**
 * song-preview.js - 30s audio previews for triaging drafts in the editor.
 *
 * Admin-only. Reads song-previews.json (built by scripts/build-previews.js)
 * and plays one preview at a time through a single shared <audio>, so the
 * sidebar can offer "hear it, judge it" without leaving the page.
 *
 * Previews are resolved ahead of time rather than looked up here: playback
 * starts on the click instead of after a round-trip, and nothing breaks when
 * Apple is slow. Songs with no match still get a YouTube search link.
 */
(function () {
  'use strict';

  var previews = {};
  var loaded = false;

  var audio = null;
  var currentSlug = null;
  var listeners = [];

  function notify() {
    listeners.forEach(function (cb) {
      try { cb(currentSlug); } catch (e) { /* a bad listener mustn't stop playback */ }
    });
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'none';
    // Previews are mastered loud; full volume next to a quiet room is harsh.
    audio.volume = 0.8;
    // Only the preview running out (or failing) clears the state on its own;
    // a pause is always one we caused in stop(), which clears it there.
    // Listening for 'pause' too would also catch the one the spec fires when
    // src is swapped mid-play, i.e. exactly when a new preview is starting.
    ['ended', 'error'].forEach(function (ev) {
      audio.addEventListener(ev, function () {
        currentSlug = null;
        notify();
      });
    });
    return audio;
  }

  var api = {
    /** Fetches the prebuilt preview map. Safe to call more than once. */
    load: function (url) {
      if (loaded) return Promise.resolve(previews);
      return fetch(url || '../song-previews.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          previews = (data && data.previews) || {};
          loaded = true;
          return previews;
        })
        .catch(function () {
          // Not generated yet - rows just fall back to the YouTube link.
          previews = {};
          loaded = true;
          return previews;
        });
    },

    /** { url, track, artist, match } for a slug, or null when unavailable. */
    get: function (slug) {
      var p = previews[slug];
      return p && p.url ? p : null;
    },

    /** Slug currently sounding, or null. */
    playing: function () {
      return currentSlug;
    },

    /** Starts a preview, replacing whatever was playing. No-op without one. */
    play: function (slug) {
      var p = api.get(slug);
      if (!p) return false;
      var el = ensureAudio();
      if (currentSlug !== slug) {
        el.src = p.url;
        currentSlug = slug;
      }
      el.currentTime = 0;
      var started = el.play();
      if (started && started.catch) started.catch(function () {
        currentSlug = null;
        notify();
      });
      notify();
      return true;
    },

    stop: function () {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      currentSlug = null;
      notify();
    },

    /** Play, or stop if this song is already the one sounding. */
    toggle: function (slug) {
      if (currentSlug === slug) {
        api.stop();
        return false;
      }
      return api.play(slug);
    },

    /** Called with the playing slug (or null) whenever playback changes. */
    onChange: function (cb) {
      listeners.push(cb);
    },

    /** Fallback for songs with no preview, and for when 30s isn't enough. */
    youtubeUrl: function (title, author) {
      var q = (title + ' ' + (author || '')).trim();
      return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    },

    /** Every entry, for building the file to commit. */
    all: function () {
      return previews;
    },

    /**
     * Replaces one song's preview locally (the editor commits the file
     * separately). Pass null to record "this song has no usable preview".
     */
    set: function (slug, entry) {
      if (currentSlug === slug) api.stop();
      if (entry) previews[slug] = entry;
      else previews[slug] = { match: 'none', locked: true };
    },

    /**
     * Live catalogue search for picking a recording by hand. The build script
     * does the same query offline, but here the point is to see the
     * alternatives it passed over - so this returns them unfiltered, in the
     * API's own order, and lets a human decide.
     */
    searchCatalogue: function (term) {
      var url = 'https://itunes.apple.com/search?media=music&entity=song&limit=12&country=CZ'
        + '&term=' + encodeURIComponent(term);
      return fetch(url)
        .then(function (r) { return r.ok ? r.json() : { results: [] }; })
        .then(function (data) {
          return (data.results || [])
            .filter(function (r) { return r.previewUrl; })
            .map(function (r) {
              return {
                url: r.previewUrl,
                track: r.trackName,
                artist: r.artistName,
                album: r.collectionName || '',
                year: (r.releaseDate || '').slice(0, 4)
              };
            });
        })
        .catch(function () { return []; });
    },

    /** Plays an arbitrary URL (a search candidate, not yet chosen). */
    playUrl: function (url, key) {
      var el = ensureAudio();
      el.src = url;
      currentSlug = key || url;
      el.currentTime = 0;
      var started = el.play();
      if (started && started.catch) started.catch(function () {
        currentSlug = null;
        notify();
      });
      notify();
    }
  };

  if (typeof window !== 'undefined') window.SongPreview = api;
})();
