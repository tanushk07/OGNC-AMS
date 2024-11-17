document.addEventListener('DOMContentLoaded', function() {
    fetch('/emp_master')
        .then(response => response.json())
        .then(data => {
            document.getElementById('emp_data').innerText = JSON.stringify(data);
        });

    fetch('/leave')
        .then(response => response.json())
        .then(data => {
            document.getElementById('leave_data').innerText = JSON.stringify(data);
        });

    fetch('/punching')
        .then(response => response.json())
        .then(data => {
            document.getElementById('punching_data').innerText = JSON.stringify(data);
        });
});
