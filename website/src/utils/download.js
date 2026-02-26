export const downloadHLVM = () => {
  const link = document.createElement('a');
  link.href = '/hlvm-installer.dmg';
  link.download = 'hlvm-installer.dmg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
