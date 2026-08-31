export function pageView(
  eyebrow: string,
  title: string,
  text: string,
): HTMLElement {

  const section =
    document.createElement('section');

  section.className = 'page-view';

  section.innerHTML = `
    <div class="page-heading">
      <span class="eyebrow">
        ${eyebrow}
      </span>

      <h1>
        ${title}
      </h1>

      <p>
        ${text}
      </p>
    </div>
  `;

  return section;
}
