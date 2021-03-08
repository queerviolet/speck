/**
 * Asynchronously load a non-module script.
 * 
 * @param {string} src 
 * @return {Promise<Event>}
 */
async function script(src) {
  const existing = document.querySelector(`script[src="${src}"]`)
  if (existing && existing.__loadingPromise)
    return existing.__loadingPromise
  const script = document.createElement('script')
  script.async = true
  script.defer = true
  script.setAttribute('::save', 'off')
  script.__loadingPromise = new Promise((resolve, reject) => {
    script.onload = resolve
    script.onerror = reject
  })
  script.src = src
  document.body.appendChild(script)
  return script.__loadingPromise
}

script('https://unpkg.com/mermaid@^8/dist/mermaid.min.js')
  .then(async () => {
    const mermaid = window.mermaid
    console.log('initializing mermaid...')
    await mermaid.initialize({
      securityLevel: 'loose',
      theme: 'dark',
      startOnLoad: true,
    })
    return mermaid
  })