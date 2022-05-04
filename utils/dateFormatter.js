const dateFormat = (sec) => {
    function pad(s){
      return (s < 10 ? '0' : '') + s;
    }
    let hours = Math.floor(sec / (60*60));
    let minutes = Math.floor(sec % (60*60) / 60);
    let seconds = Math.floor(sec % 60);
  
    return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
}

module.exports = {dateFormat};