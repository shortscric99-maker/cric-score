export function friendlySlug(s){
  return s.toString().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
}

export function toCSV(objArray){
  const arr = Array.isArray(objArray) ? objArray : JSON.parse(objArray);
  if(!arr.length) return '';
  const keys = Object.keys(arr[0]);
  const lines = [keys.join(',')].concat(arr.map(o => keys.map(k => JSON.stringify(o[k] ?? '')).join(',')));
  return lines.join('\n');
}

export function downloadFile(filename, content, mime='text/plain'){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
