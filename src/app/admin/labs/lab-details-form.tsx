'use client'

import { Button, Field, FieldDescription, FieldLabel, Input, Textarea } from '@gears-frontx/ui-kit'
import type { LabRepository } from '@/lib/lab-input'
import { CloseMark } from '@/app/marks'

export interface LabFormValues {
  name: string
  description: string
  repositories: { url: string; description: string }[]
}

export const EMPTY_REPOSITORY = { url: '', description: '' }

export function formValuesFrom(lab: { name: string; description: string; repositories: LabRepository[] }): LabFormValues {
  return {
    name: lab.name,
    description: lab.description,
    repositories: [
      ...lab.repositories.map((repository) => ({ url: repository.url, description: repository.description ?? '' })),
      EMPTY_REPOSITORY,
    ],
  }
}

/**
 * IDEA-156 — the Lab fields shared by the create form and a Lab's own edit
 * form: name, description, and a list of repository rows (URL plus an
 * optional one-line description). There is always one empty row at the
 * end to type into — typing into it appends another — and blank rows are
 * dropped server-side (labs.ts's normalizeLabInput), so the form never needs
 * an "Add repository" button. Controlled: the parent owns `values`.
 */
export function LabDetailsForm({
  values,
  onChange,
  disabled,
}: {
  values: LabFormValues
  onChange: (values: LabFormValues) => void
  disabled?: boolean
}) {
  function setRepository(index: number, next: { url: string; description: string }) {
    const repositories = values.repositories.map((repository, i) => (i === index ? next : repository))
    const last = repositories[repositories.length - 1]
    if (last && (last.url || last.description)) repositories.push(EMPTY_REPOSITORY)
    onChange({ ...values, repositories })
  }

  function removeRepository(index: number) {
    const repositories = values.repositories.filter((_, i) => i !== index)
    onChange({ ...values, repositories: repositories.length > 0 ? repositories : [EMPTY_REPOSITORY] })
  }

  return (
    <>
      <Field name="lab-name">
        <FieldLabel>Name</FieldLabel>
        <Input
          value={values.name}
          onValueChange={(name) => onChange({ ...values, name })}
          placeholder="e.g. Agentic Search"
          disabled={disabled}
        />
      </Field>
      <Field name="lab-description">
        <FieldLabel>Description</FieldLabel>
        <Textarea
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          placeholder="What is this Lab researching or prototyping?"
          disabled={disabled}
        />
      </Field>
      <Field name="lab-repositories">
        <FieldLabel>Repositories</FieldLabel>
        <FieldDescription>One GitHub repository per row; the description is optional.</FieldDescription>
        <div className="lab-repository-rows">
          {values.repositories.map((repository, index) => {
            const isTrailingBlank = index === values.repositories.length - 1 && !repository.url && !repository.description
            return (
              <div className="lab-repository-row" key={index}>
                <Input
                  value={repository.url}
                  onValueChange={(url) => setRepository(index, { ...repository, url })}
                  placeholder="https://github.com/constructorfabric/…"
                  aria-label={`Repository ${index + 1} URL`}
                  disabled={disabled}
                />
                <Input
                  value={repository.description}
                  onValueChange={(description) => setRepository(index, { ...repository, description })}
                  placeholder="Description (optional)"
                  aria-label={`Repository ${index + 1} description`}
                  disabled={disabled}
                />
                <Button
                  variant="outline"
                  size="sm"
                  icon={<CloseMark />}
                  title="Remove this repository"
                  aria-label={`Remove repository ${index + 1}`}
                  onClick={() => removeRepository(index)}
                  disabled={disabled || isTrailingBlank}
                />
              </div>
            )
          })}
        </div>
      </Field>
    </>
  )
}

