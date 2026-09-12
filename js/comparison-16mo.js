// SAL Anomaly Dashboard — 16-month suite (Oct 2016 – Jan 2018)
(function () {
  'use strict';

  var RUNS = [
    { key: 'bpanomaly',    label: 'BP Anomaly (GOFS)',      color: '#2ca02c' },
    { key: 'atm-tide',     label: 'Atm + Tide',             color: '#1f77b4' },
    { key: 'tide-only',    label: 'Tide Only',              color: '#9467bd' },
    { key: 'tide-nosal',   label: 'Tide (no SAL)',          color: '#e377c2' },
    { key: 'atm-only',     label: 'Atm Only',               color: '#d62728' },
    { key: 'atm-tide-del4',label: 'Atm+Tide del4 (1.9e9)', color: '#ff7f0e' },
    { key: 'gofs-noatm',   label: 'GOFS (no atm)',          color: '#8c564b' },
  ];
  var OBS_COLOR = '#000000';

  var DATA_ROOT = 'data/dashboard-16mo/';

  // -----------------------------------------------------------------------
  // Map setup
  // -----------------------------------------------------------------------

  var map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);

  var selectedMarker = null;
  var markerLayer = L.layerGroup().addTo(map);
  var allStations = [];
  var markerById = {};
  var currentData = null;
  var TARGET_POINTS = 5000;

  var runVisible = {};
  RUNS.forEach(function (r) { runVisible[r.key] = true; });
  var demeanEnabled = false;

  // -----------------------------------------------------------------------
  // Marker coloring
  // -----------------------------------------------------------------------

  function rmseColor(rmse) {
    if (rmse === null || rmse === undefined || isNaN(rmse)) return '#999999';
    if (rmse < 0.10) return '#2ca02c';
    if (rmse < 0.25) return '#ff7f0e';
    return '#d62728';
  }

  function rmseLabel(rmse) {
    if (rmse === null || rmse === undefined || isNaN(rmse)) return 'N/A';
    return rmse.toFixed(3) + ' m';
  }

  // -----------------------------------------------------------------------
  // LTTB downsampling
  // -----------------------------------------------------------------------

  function lttbIndices(y, target) {
    var n = y.length;
    if (target >= n || target < 3) {
      var all = new Array(n);
      for (var k = 0; k < n; k++) all[k] = k;
      return all;
    }
    var indices = [0];
    var bucketSize = (n - 2) / (target - 2);
    var prevIndex = 0;
    for (var i = 1; i < target - 1; i++) {
      var rangeStart = Math.floor((i - 1) * bucketSize) + 1;
      var rangeEnd = Math.min(Math.floor(i * bucketSize) + 1, n);
      var nextStart = Math.min(Math.floor(i * bucketSize) + 1, n - 1);
      var nextEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
      var avgX = 0, avgY = 0, cnt = 0;
      for (var j = nextStart; j < nextEnd; j++) {
        if (y[j] !== null) { avgX += j; avgY += y[j]; cnt++; }
      }
      if (cnt > 0) { avgX /= cnt; avgY /= cnt; }
      var maxArea = -1, bestIdx = rangeStart;
      var pX = prevIndex, pY = y[prevIndex] || 0;
      for (var j = rangeStart; j < rangeEnd; j++) {
        if (y[j] === null) continue;
        var area = Math.abs((pX - avgX) * (y[j] - pY) - (pX - j) * (avgY - pY));
        if (area > maxArea) { maxArea = area; bestIdx = j; }
      }
      indices.push(bestIdx);
      prevIndex = bestIdx;
    }
    indices.push(n - 1);
    return indices;
  }

  function pickByIndices(arr, indices) {
    var out = new Array(indices.length);
    for (var i = 0; i < indices.length; i++) out[i] = arr[indices[i]];
    return out;
  }

  function mmToM(arr) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      out[i] = arr[i] !== null ? arr[i] / 1000 : null;
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Load stations
  // -----------------------------------------------------------------------

  fetch(DATA_ROOT + 'stations.json')
    .then(function (r) { return r.json(); })
    .then(function (stations) {
      var primaryKey = RUNS[0].key;

      stations.forEach(function (stn) {
        var rmse = stn.metrics && stn.metrics[primaryKey]
          ? stn.metrics[primaryKey].rmse_m
          : null;
        var color = rmseColor(rmse);

        var marker = L.circleMarker([stn.latitude, stn.longitude], {
          radius: 5,
          color: color,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 1,
        });

        var popupHtml = '<b>' + stn.site_name + '</b>';
        if (stn.country) popupHtml += ' (' + stn.country + ')';
        popupHtml += '<br>';

        if (stn.metrics) {
          RUNS.forEach(function (r) {
            var m = stn.metrics[r.key];
            if (!m || m.rmse_m === null) return;
            popupHtml += '<div style="margin-top:4px"><strong>' + r.label + '</strong></div>';
            popupHtml +=
              '<div class="metric-row"><span>RMSE:</span> <span>' + rmseLabel(m.rmse_m) + '</span></div>' +
              '<div class="metric-row"><span>r:</span> <span>' + (m.correlation == null || isNaN(m.correlation) ? 'N/A' : m.correlation.toFixed(3)) + '</span></div>' +
              '<div class="metric-row"><span>Bias:</span> <span>' + (m.bias_m == null ? 'N/A' : m.bias_m.toFixed(3) + ' m') + '</span></div>';
          });
          if (stn.metrics[primaryKey] && stn.metrics[primaryKey].n_hours) {
            popupHtml +=
              '<div class="metric-row"><span>Overlap:</span> <span>' +
              stn.metrics[primaryKey].n_hours.toLocaleString() + ' hrs</span></div>';
          }
        }

        marker.bindPopup(popupHtml);
        marker.on('click', function () { selectStation(stn.station_id, marker); });
        marker.stationId = stn.station_id;
        markerById[stn.station_id] = marker;
        markerLayer.addLayer(marker);
      });

      allStations = stations;
      addSearchControl();
      addLegend();
    })
    .catch(function (err) { console.error('Failed to load stations.json:', err); });

  // -----------------------------------------------------------------------
  // Search control
  // -----------------------------------------------------------------------

  function addSearchControl() {
    var search = L.control({ position: 'topright' });
    search.onAdd = function () {
      var wrap = L.DomUtil.create('div', 'station-search');
      wrap.innerHTML =
        '<input type="text" id="station-search-input" placeholder="Search stations...">' +
        '<ul id="station-search-results"></ul>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      return wrap;
    };
    search.addTo(map);

    var input = document.getElementById('station-search-input');
    var resultsList = document.getElementById('station-search-results');

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      resultsList.innerHTML = '';
      if (q.length < 2) return;
      var matches = allStations.filter(function (s) {
        return s.site_name.toLowerCase().indexOf(q) !== -1 ||
          (s.country && s.country.toLowerCase().indexOf(q) !== -1) ||
          s.station_id.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 12);
      matches.forEach(function (s) {
        var li = document.createElement('li');
        li.textContent = s.site_name + (s.country ? ' (' + s.country + ')' : '');
        li.addEventListener('click', function () {
          resultsList.innerHTML = '';
          input.value = s.site_name;
          var marker = markerById[s.station_id];
          if (marker) {
            map.flyTo([s.latitude, s.longitude], 8, { duration: 0.8 });
            marker.openPopup();
            selectStation(s.station_id, marker);
          }
        });
        resultsList.appendChild(li);
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.station-search')) resultsList.innerHTML = '';
    });
  }

  // -----------------------------------------------------------------------
  // Legend
  // -----------------------------------------------------------------------

  function addLegend() {
    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      var div = L.DomUtil.create('div', 'legend');
      div.innerHTML =
        '<b>SSH RMSE (BP Anomaly run)</b>' +
        '<br><i style="background:#2ca02c"></i> &lt; 0.10 m' +
        '<br><i style="background:#ff7f0e"></i> 0.10 &ndash; 0.25 m' +
        '<br><i style="background:#d62728"></i> &gt; 0.25 m' +
        '<br><i style="background:#999999"></i> N/A';
      return div;
    };
    legend.addTo(map);
  }

  // -----------------------------------------------------------------------
  // Run toggle checkboxes
  // -----------------------------------------------------------------------

  function buildRunToggles() {
    var container = document.getElementById('run-toggles');
    if (!container) return;
    container.innerHTML = '';
    RUNS.forEach(function (r) {
      var lbl = document.createElement('label');
      lbl.className = 'run-toggle-label';
      lbl.style.color = r.color;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = runVisible[r.key];
      cb.addEventListener('change', function () {
        runVisible[r.key] = cb.checked;
        replot();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + r.label));
      container.appendChild(lbl);
    });
  }

  // -----------------------------------------------------------------------
  // Station selection
  // -----------------------------------------------------------------------

  function selectStation(stationId, marker) {
    if (selectedMarker) selectedMarker.setStyle({ weight: 1, radius: 5 });
    marker.setStyle({ weight: 3, radius: 8 });
    selectedMarker = marker;
    loadTimeseries(stationId);
    var controls = document.getElementById('plot-controls');
    if (controls) controls.style.display = '';
    buildRunToggles();
  }

  // -----------------------------------------------------------------------
  // Time series loading
  // -----------------------------------------------------------------------

  function loadTimeseries(stationId) {
    var panel = document.getElementById('timeseries-panel');
    var placeholder = panel.querySelector('.placeholder');
    var plotDiv = document.getElementById('timeseries-plot');

    if (placeholder) placeholder.style.display = 'none';
    plotDiv.innerHTML = '<p style="color:#6c757d;padding:1rem">Loading...</p>';

    fetch(DATA_ROOT + 'timeseries/' + stationId + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { renderTimeseries(data, plotDiv); })
      .catch(function (err) {
        plotDiv.innerHTML =
          '<p style="color:#d62728;padding:1rem">Failed to load time series: ' + err.message + '</p>';
      });
  }

  // -----------------------------------------------------------------------
  // Trace building
  // -----------------------------------------------------------------------

  function buildTracesForRange(data, startIdx, endIdx, target) {
    var n = endIdx - startIdx;
    var startMs = new Date(data.t0).getTime();
    var stepMs = data.dt_hours * 3600000;

    var primaryArr = data['obs'] ? data['obs'].slice(startIdx, endIdx) : null;
    if (!primaryArr) {
      for (var ri = 0; ri < RUNS.length; ri++) {
        var arr = data[RUNS[ri].key];
        if (arr) { primaryArr = arr.slice(startIdx, endIdx); break; }
      }
    }

    var idx;
    if (primaryArr && n > target) {
      idx = lttbIndices(primaryArr, target);
    } else {
      idx = new Array(n);
      for (var k = 0; k < n; k++) idx[k] = k;
    }

    var times = new Array(idx.length);
    for (var i = 0; i < idx.length; i++) {
      times[i] = new Date(startMs + (startIdx + idx[i]) * stepMs).toISOString().slice(0, 19);
    }

    var toM = (data.units === 'mm') ? function(a) { return mmToM(a); } : function(a) { return a; };

    function seriesMean(key) {
      var full = data[key];
      if (!full) return 0;
      var sum = 0, cnt = 0;
      for (var i = 0; i < full.length; i++) {
        if (full[i] !== null) { sum += full[i]; cnt++; }
      }
      return cnt > 0 ? sum / cnt : 0;
    }

    function applyScale(arr, meanRaw) {
      var out = toM(arr);
      if (!demeanEnabled) return out;
      var meanM = (data.units === 'mm') ? meanRaw / 1000 : meanRaw;
      for (var i = 0; i < out.length; i++) {
        if (out[i] !== null) out[i] -= meanM;
      }
      return out;
    }

    var traces = [];

    if (data['obs']) {
      traces.push({
        x: times,
        y: applyScale(pickByIndices(data['obs'].slice(startIdx, endIdx), idx), seriesMean('obs')),
        type: 'scattergl', mode: 'lines',
        name: 'GESLA obs',
        line: { color: OBS_COLOR, width: 1.5 },
        connectgaps: false,
      });
    }

    RUNS.forEach(function (r) {
      if (!runVisible[r.key]) return;
      if (!data[r.key]) return;
      traces.push({
        x: times,
        y: applyScale(pickByIndices(data[r.key].slice(startIdx, endIdx), idx), seriesMean(r.key)),
        type: 'scattergl', mode: 'lines',
        name: r.label,
        line: { color: r.color, width: 1 },
        connectgaps: false,
      });
    });

    return traces;
  }

  function replot() {
    if (!currentData) return;
    renderTimeseries(currentData, document.getElementById('timeseries-plot'));
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  function renderTimeseries(data, plotDiv) {
    plotDiv.innerHTML = '';
    currentData = data;

    var traces = buildTracesForRange(data, 0, data.n, TARGET_POINTS);
    var primaryMetrics = data.metrics && data.metrics[RUNS[0].key]
      ? data.metrics[RUNS[0].key] : null;

    var annotations = [];
    if (primaryMetrics) {
      var m = primaryMetrics;
      var txt = RUNS[0].label + ':  ' +
        'RMSE ' + (m.rmse_m == null ? 'N/A' : m.rmse_m.toFixed(3) + ' m') + '  |  ' +
        'r ' + (m.correlation == null || isNaN(m.correlation) ? 'N/A' : m.correlation.toFixed(3)) + '  |  ' +
        'Bias ' + (m.bias_m == null ? 'N/A' : m.bias_m.toFixed(3) + ' m');
      if (m.n_hours) txt += '  |  N ' + m.n_hours.toLocaleString() + ' hrs';
      annotations.push({
        text: txt,
        xref: 'paper', yref: 'paper',
        x: 0.01, y: 0.99,
        xanchor: 'left', yanchor: 'top',
        showarrow: false,
        font: { size: 11 },
        bgcolor: 'rgba(255,255,255,0.85)',
        borderpad: 4,
      });
    }

    var title = data.site_name || data.station_id;
    if (data.country) title += ' (' + data.country + ')';

    var yLabel = demeanEnabled ? 'Sea level anomaly (m)' : 'Sea level (m)';

    Plotly.newPlot(plotDiv, traces, {
      xaxis: { title: 'Date' },
      yaxis: { title: yLabel },
      title: { text: title, font: { size: 14 } },
      annotations: annotations,
      legend: { orientation: 'h', y: 1.08 },
      margin: { l: 60, r: 20, t: 60, b: 50 },
      template: 'plotly_white',
    }, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    });

    plotDiv.on('plotly_relayout', function (evt) {
      if (!currentData) return;
      var xMin = evt['xaxis.range[0]'];
      var xMax = evt['xaxis.range[1]'];
      if (!xMin || !xMax) return;
      var startMs = new Date(currentData.t0).getTime();
      var stepMs = currentData.dt_hours * 3600000;
      var i0 = Math.max(0, Math.floor((new Date(xMin).getTime() - startMs) / stepMs));
      var i1 = Math.min(currentData.n, Math.ceil((new Date(xMax).getTime() - startMs) / stepMs));
      if (i1 <= i0) return;
      Plotly.react(plotDiv, buildTracesForRange(currentData, i0, i1, TARGET_POINTS), plotDiv.layout, {
        responsive: true, displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      });
    });
  }

  // -----------------------------------------------------------------------
  // Toggles
  // -----------------------------------------------------------------------

  var demeanBox = document.getElementById('demean-toggle');
  if (demeanBox) {
    demeanBox.addEventListener('change', function () {
      demeanEnabled = demeanBox.checked;
      replot();
    });
  }

})();
