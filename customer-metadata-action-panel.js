function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireRoot(root) {
  if (!root || typeof root.replaceChildren !== 'function') throw new TypeError('root must support replaceChildren');
  return root;
}

function field(documentRef, { label, name, maxLength, multiline = false }) {
  const wrapper = documentRef.createElement('label');
  wrapper.className = 'sv-customer-action__field';
  const caption = documentRef.createElement('span');
  caption.className = 'sv-customer-action__label';
  caption.textContent = label;
  const input = documentRef.createElement(multiline ? 'textarea' : 'input');
  input.className = 'sv-customer-action__input';
  input.name = name;
  input.maxLength = maxLength;
  input.required = true;
  if (!multiline) input.type = 'text';
  wrapper.append(caption, input);
  return { wrapper, input };
}

export function createCustomerMetadataActionPanel({
  root,
  controller,
  documentRef = globalThis.document
} = {}) {
  requireRoot(root);
  if (!controller || typeof controller !== 'object') throw new TypeError('controller is required');
  requireFunction(controller.execute, 'controller.execute');
  if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('documentRef must support createElement');

  let mounted = false;
  let submitting = false;

  function render() {
    const section = documentRef.createElement('section');
    section.className = 'sv-customer-panel sv-customer-action';
    section.setAttribute('aria-labelledby', 'sv-customer-action-title');

    const title = documentRef.createElement('h2');
    title.id = 'sv-customer-action-title';
    title.className = 'sv-customer-panel__title';
    title.textContent = 'Действия CRM';

    const form = documentRef.createElement('form');
    form.className = 'sv-customer-action__form';

    const operationLabel = documentRef.createElement('label');
    operationLabel.className = 'sv-customer-action__field';
    const operationCaption = documentRef.createElement('span');
    operationCaption.className = 'sv-customer-action__label';
    operationCaption.textContent = 'Действие';
    const operation = documentRef.createElement('select');
    operation.className = 'sv-customer-action__input';
    operation.name = 'operation';
    for (const [value, label] of [
      ['addNote', 'Добавить служебную заметку'],
      ['addTag', 'Добавить тег'],
      ['removeTag', 'Снять тег'],
      ['addSegment', 'Добавить в сегмент'],
      ['removeSegment', 'Убрать из сегмента']
    ]) {
      const option = documentRef.createElement('option');
      option.value = value;
      option.textContent = label;
      operation.append(option);
    }
    operationLabel.append(operationCaption, operation);

    const valueField = field(documentRef, { label: 'Значение', name: 'value', maxLength: 2000, multiline: true });
    const reasonField = field(documentRef, { label: 'Причина', name: 'reason', maxLength: 500, multiline: true });

    const status = documentRef.createElement('p');
    status.className = 'sv-customer-action__status';
    status.setAttribute('aria-live', 'polite');

    const submit = documentRef.createElement('button');
    submit.type = 'submit';
    submit.className = 'sv-customer-action__submit';
    submit.textContent = 'Продолжить';

    function setPending(value) {
      submitting = value;
      operation.disabled = value;
      valueField.input.disabled = value;
      reasonField.input.disabled = value;
      submit.disabled = value;
      submit.textContent = value ? 'Выполняется…' : 'Продолжить';
      form.setAttribute('aria-busy', value ? 'true' : 'false');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitting) return;
      status.textContent = '';
      const kind = operation.value;
      const value = valueField.input.value;
      const reason = reasonField.input.value;
      const valueFieldName = kind === 'addNote' ? 'note' : kind.includes('Segment') ? 'segment' : 'tag';
      setPending(true);
      try {
        const result = await controller.execute(kind, { [valueFieldName]: value, reason });
        if (!mounted) return;
        if (result?.ok) {
          status.textContent = 'Изменение сохранено и будет отражено в истории.';
          valueField.input.value = '';
          reasonField.input.value = '';
        } else if (result?.reason === 'cancelled') {
          status.textContent = 'Действие отменено. Изменений нет.';
        } else if (result?.reason === 'already_pending') {
          status.textContent = 'Предыдущее действие ещё выполняется.';
        }
      } catch {
        if (mounted) status.textContent = 'Не удалось выполнить действие. Данные не подменены; проверьте scope и повторите позже.';
      } finally {
        if (mounted) setPending(false);
      }
    });

    form.append(operationLabel, valueField.wrapper, reasonField.wrapper, status, submit);
    section.append(title, form);
    return section;
  }

  function mount() {
    if (mounted) return false;
    mounted = true;
    root.replaceChildren(render());
    return true;
  }

  function unmount() {
    if (!mounted) return false;
    mounted = false;
    root.replaceChildren();
    return true;
  }

  return Object.freeze({ mount, unmount, get mounted() { return mounted; }, get submitting() { return submitting; } });
}

export const customerMetadataActionPanelContract = Object.freeze({
  explicitSubmit: true,
  confirmationDelegatedToController: true,
  reasonRequired: true,
  duplicateSubmitSuppressed: true,
  honestPendingErrorCancelStates: true,
  touchFriendlyStylingExpected: true,
  productionNavigationWiring: false,
  dependenciesAdded: false
});
